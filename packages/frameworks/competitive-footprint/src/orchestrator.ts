import {
  ContractValidationError,
  type Account,
  type AccountSource,
  type Clock,
  type CompetitiveFootprintConfig,
  type RunContext,
  type RunFailure,
  type RunIntent,
  type RunResult,
  type SignalDetector,
  type SignalObservation,
  type SignalState,
  type SignalStateStore,
  type SignalTransition,
  type TransitionDestination,
  PortOperationError,
  validateAccount,
  validateConfig,
  validateObservation,
} from "@growth-frameworks/contracts/competitive-footprint";

import { selectDue } from "./due-selection.ts";
import { createOperationKey, decideTransition, type TransitionPolicy } from "./transition.ts";

export interface CompetitiveFootprintDependencies {
  readonly accountSource: AccountSource;
  readonly detectors: readonly SignalDetector[];
  readonly stateStore: SignalStateStore;
  readonly destinations: readonly TransitionDestination[];
  readonly clock: Clock;
  readonly transitionPolicy: (
    prior: SignalState | null,
    observation: SignalObservation,
  ) => TransitionPolicy;
}

export class FrameworkOperationError extends PortOperationError {
  override readonly name = "FrameworkOperationError";
}

interface MutableRunResult {
  selected: number;
  processed: number;
  changed: number;
  unchanged: number;
  skipped: number;
  failed: number;
  failures: RunFailure[];
  intents: RunIntent[];
}

export async function runCompetitiveFootprint(
  context: RunContext,
  configInput: CompetitiveFootprintConfig,
  dependencies: CompetitiveFootprintDependencies,
): Promise<RunResult> {
  const config = validateConfig(configInput);
  const detectors = resolveDetectors(config, dependencies.detectors);
  const result = createMutableResult();

  try {
    for await (const accountInput of dependencies.accountSource.listAccounts(context)) {
      let account: Account;
      try {
        account = validateAccount(accountInput);
      } catch (error) {
        recordFailure(result, "validate_account", error, accountInput.id);
        continue;
      }

      for (const detector of detectors) {
        await processAccountDetector(account, detector, context, config, dependencies, result);
      }
    }
  } catch (error) {
    recordFailure(result, "list_accounts", error);
    return finalizeResult(context.runId, result, "failed");
  }

  return finalizeResult(context.runId, result);
}

async function processAccountDetector(
  account: Account,
  detector: SignalDetector,
  context: RunContext,
  config: CompetitiveFootprintConfig,
  dependencies: CompetitiveFootprintDependencies,
  result: MutableRunResult,
): Promise<void> {
  result.selected += 1;
  let prior: SignalState | null;
  try {
    prior = await dependencies.stateStore.get(account.id, detector.id);
    const selection = selectDue(account, prior, config.cadence, dependencies.clock.now());
    if (!selection.due) {
      result.skipped += 1;
      return;
    }
  } catch (error) {
    recordFailure(result, "select_due", error, account.id);
    return;
  }

  let observation: SignalObservation;
  try {
    observation = validateObservation(await detector.observe(account, context));
    assertObservationIdentity(account, detector, observation);
  } catch (error) {
    recordFailure(result, `detect:${detector.id}`, error, account.id);
    return;
  }

  result.processed += 1;
  let decision: ReturnType<typeof decideTransition>;
  try {
    decision = decideTransition(
      prior,
      observation,
      dependencies.transitionPolicy(prior, observation),
    );
  } catch (error) {
    recordFailure(result, "decide_transition", error, account.id);
    return;
  }
  const operationKey = createOperationKey(observation);
  result.intents.push(createIntent("persist_state", operationKey, observation, context.dryRun));
  if (decision.transition !== null) {
    result.intents.push(
      createIntent("deliver_transition", decision.transition.idempotencyKey, observation, context.dryRun),
    );
  }

  if (context.dryRun) {
    recordDecisionCount(result, decision.transition);
    return;
  }

  let recordResult: "created" | "duplicate";
  try {
    recordResult = await dependencies.stateStore.record(
      observation,
      decision.next,
      decision.transition,
    );
  } catch (error) {
    recordFailure(result, "persist_state", error, account.id);
    return;
  }

  if (recordResult === "duplicate") {
    result.skipped += 1;
    result.unchanged += 1;
    return;
  }

  recordDecisionCount(result, decision.transition);
  if (decision.transition === null) return;

  for (const destination of dependencies.destinations) {
    try {
      await destination.deliver(decision.transition, context);
    } catch (error) {
      recordFailure(result, "deliver_transition", error, account.id);
    }
  }
}

function resolveDetectors(
  config: CompetitiveFootprintConfig,
  available: readonly SignalDetector[],
): readonly SignalDetector[] {
  const byId = new Map(available.map((detector) => [detector.id, detector]));
  const missing = config.detectorIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new ContractValidationError([`configured detectors are unavailable: ${missing.join(", ")}`]);
  }
  return config.detectorIds.map((id) => byId.get(id)!);
}

function assertObservationIdentity(
  account: Account,
  detector: SignalDetector,
  observation: SignalObservation,
): void {
  if (
    observation.accountId !== account.id ||
    observation.detectorId !== detector.id ||
    observation.detectorKind !== detector.kind
  ) {
    throw new ContractValidationError(["detector observation identity does not match its request"]);
  }
}

function createIntent(
  kind: RunIntent["kind"],
  idempotencyKey: string,
  observation: SignalObservation,
  dryRun: boolean,
): RunIntent {
  return {
    kind,
    idempotencyKey,
    accountId: observation.accountId,
    detectorId: observation.detectorId,
    dryRun,
  };
}

function createMutableResult(): MutableRunResult {
  return {
    selected: 0,
    processed: 0,
    changed: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    failures: [],
    intents: [],
  };
}

function recordDecisionCount(result: MutableRunResult, transition: SignalTransition | null): void {
  if (transition === null) result.unchanged += 1;
  else result.changed += 1;
}

function recordFailure(
  result: MutableRunResult,
  operation: string,
  error: unknown,
  accountId?: string,
): void {
  const failure = toRunFailure(operation, error, accountId);
  result.failed += 1;
  result.failures.push(failure);
}

function toRunFailure(operation: string, error: unknown, accountId?: string): RunFailure {
  const details =
    error instanceof PortOperationError
      ? { category: error.category, retryable: error.retryable }
      : error instanceof ContractValidationError
        ? { category: "validation" as const, retryable: false }
        : { category: "permanent" as const, retryable: false };
  const message = error instanceof Error ? error.message : "Unknown operation failure";

  return accountId === undefined
    ? { operation, message, ...details }
    : { operation, accountId, message, ...details };
}

function finalizeResult(
  runId: string,
  result: MutableRunResult,
  forcedStatus?: RunResult["status"],
): RunResult {
  const status = forcedStatus ?? (result.failed > 0 ? "partial_failure" : "succeeded");
  return { runId, status, ...result };
}
