import {
  PortOperationError,
  type Clock,
  type ErrorCategory,
  type RunContext,
  type TransitionDestination,
  type TransitionOutbox,
} from "@growth-frameworks/contracts/competitive-footprint";

export interface TransitionDispatchFailure {
  readonly idempotencyKey: string;
  readonly stage: "record_attempt" | "deliver" | "record_receipt";
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly duplicateRisk: boolean;
  readonly message: string;
}

export interface TransitionDispatchResult {
  readonly selected: number;
  readonly delivered: number;
  readonly retryableFailures: number;
  readonly terminalFailures: number;
  readonly exhausted: number;
  readonly skipped: number;
  readonly failures: readonly TransitionDispatchFailure[];
}

export interface TransitionDispatcherOptions {
  readonly limit: number;
  readonly maxAttempts: number;
}

export interface TransitionDispatcherDependencies {
  readonly outbox: TransitionOutbox;
  readonly destination: TransitionDestination;
  readonly clock: Clock;
}

export async function dispatchPendingTransitions(
  context: RunContext,
  options: TransitionDispatcherOptions,
  dependencies: TransitionDispatcherDependencies,
): Promise<TransitionDispatchResult> {
  if (context.dryRun) throw new PortOperationError("Outbox delivery is disabled during dry run", "authorization", false);
  validateOptions(options);
  const pending = await dependencies.outbox.listPending(options.limit);
  const result: MutableDispatchResult = {
    selected: pending.length,
    delivered: 0,
    retryableFailures: 0,
    terminalFailures: 0,
    exhausted: 0,
    skipped: 0,
    failures: [],
  };

  for (const item of pending) {
    const key = item.transition.idempotencyKey;
    if (item.attempts >= options.maxAttempts) {
      result.exhausted += 1;
      continue;
    }

    const attemptedAt = canonicalNow(dependencies.clock);
    let attemptResult: Awaited<ReturnType<TransitionOutbox["recordAttempt"]>>;
    try {
      attemptResult = await dependencies.outbox.recordAttempt(key, item.attempts, attemptedAt);
    } catch (error) {
      recordFailure(result, key, "record_attempt", error, false);
      continue;
    }
    if (attemptResult !== "recorded") {
      result.skipped += 1;
      continue;
    }

    try {
      await dependencies.destination.deliver(item.transition, context);
    } catch (error) {
      recordFailure(result, key, "deliver", error, false);
      continue;
    }

    try {
      const receipt = await dependencies.outbox.markDelivered(key, canonicalNow(dependencies.clock));
      if (receipt === "recorded") result.delivered += 1;
      else result.skipped += 1;
    } catch (error) {
      recordFailure(result, key, "record_receipt", error, true);
    }
  }

  return result;
}

interface MutableDispatchResult {
  selected: number;
  delivered: number;
  retryableFailures: number;
  terminalFailures: number;
  exhausted: number;
  skipped: number;
  failures: TransitionDispatchFailure[];
}

function validateOptions(options: TransitionDispatcherOptions): void {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new TypeError("Dispatch limit must be an integer from 1 to 100");
  }
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 10) {
    throw new TypeError("Maximum delivery attempts must be an integer from 1 to 10");
  }
}

function canonicalNow(clock: Clock): string {
  const now = clock.now();
  if (Number.isNaN(now.getTime())) throw new TypeError("Dispatcher clock returned an invalid time");
  return now.toISOString();
}

function recordFailure(
  result: MutableDispatchResult,
  idempotencyKey: string,
  stage: TransitionDispatchFailure["stage"],
  error: unknown,
  duplicateRisk: boolean,
): void {
  const operationError =
    error instanceof PortOperationError
      ? error
      : new PortOperationError("Transition dispatch operation failed", "transient", true, { cause: error });
  if (operationError.retryable) result.retryableFailures += 1;
  else result.terminalFailures += 1;
  result.failures.push({
    idempotencyKey,
    stage,
    category: operationError.category,
    retryable: operationError.retryable,
    duplicateRisk,
    message: operationError.message,
  });
}
