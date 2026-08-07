export const accountSegments = ["high_priority", "standard", "low_priority"] as const;
export type AccountSegment = (typeof accountSegments)[number];

export const detectorKinds = ["dns", "txt", "subdomain", "tcp"] as const;
export type DetectorKind = (typeof detectorKinds)[number];

export const observationStatuses = ["positive", "negative", "indeterminate"] as const;
export type ObservationStatus = (typeof observationStatuses)[number];

export const confidenceLevels = ["low", "medium", "high"] as const;
export type Confidence = (typeof confidenceLevels)[number];

export const signalStates = ["unknown", "possible", "confirmed", "historical", "lost"] as const;
export type SignalStateName = (typeof signalStates)[number];

export const transitionKinds = [
  "none",
  "detected",
  "confidence_upgraded",
  "signal_changed",
  "lost",
  "restored",
  "cleared",
] as const;
export type TransitionKind = (typeof transitionKinds)[number];

export const errorCategories = [
  "validation",
  "authorization",
  "rate_limited",
  "transient",
  "permanent",
  "conflict",
] as const;
export type ErrorCategory = (typeof errorCategories)[number];

export interface ExternalReference {
  readonly system: string;
  readonly id: string;
}

export interface Account {
  readonly id: string;
  readonly displayName: string;
  readonly domain: string;
  readonly segment: AccountSegment;
  readonly externalReferences?: readonly ExternalReference[];
}

export interface SignalObservation {
  readonly accountId: string;
  readonly detectorId: string;
  readonly detectorKind: DetectorKind;
  readonly observedAt: string;
  readonly status: ObservationStatus;
  readonly confidence: Confidence;
  readonly evidenceCodes: readonly string[];
  readonly fingerprint: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface SignalState {
  readonly accountId: string;
  readonly detectorId: string;
  readonly state: SignalStateName;
  readonly confidence: Confidence | null;
  readonly lastCheckedAt: string | null;
  readonly lastConclusiveObservationAt: string | null;
  readonly evidenceCodes: readonly string[];
  readonly version: number;
}

export interface SignalTransition {
  readonly idempotencyKey: string;
  readonly kind: Exclude<TransitionKind, "none">;
  readonly accountId: string;
  readonly detectorId: string;
  readonly occurredAt: string;
  readonly previous: SignalState;
  readonly next: SignalState;
}

export interface CadenceRule {
  readonly segment: AccountSegment;
  readonly state: SignalStateName;
  readonly intervalHours: number;
}

export interface CompetitiveFootprintConfig {
  readonly detectorIds: readonly string[];
  readonly cadence: readonly CadenceRule[];
  readonly lossConfirmationCount: number;
}

export interface RunContext {
  readonly runId: string;
  readonly startedAt: string;
  readonly dryRun: boolean;
}

export type RunStatus = "succeeded" | "partial_failure" | "failed";

export interface RunFailure {
  readonly category: ErrorCategory;
  readonly operation: string;
  readonly accountId?: string;
  readonly retryable: boolean;
  readonly message: string;
}

export interface RunIntent {
  readonly kind: "persist_state" | "deliver_transition";
  readonly idempotencyKey: string;
  readonly accountId: string;
  readonly detectorId: string;
  readonly dryRun: boolean;
}

export interface RunResult {
  readonly runId: string;
  readonly status: RunStatus;
  readonly selected: number;
  readonly processed: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly skipped: number;
  readonly failed: number;
  readonly failures: readonly RunFailure[];
  readonly intents: readonly RunIntent[];
}

export interface AccountSource {
  listAccounts(context: RunContext): AsyncIterable<Account>;
}

export interface SignalDetector {
  readonly id: string;
  readonly kind: DetectorKind;
  observe(account: Account, context: RunContext): Promise<SignalObservation>;
}

export interface SignalStateStore {
  get(accountId: string, detectorId: string): Promise<SignalState | null>;
  record(
    observation: SignalObservation,
    next: SignalState,
    transition: SignalTransition | null,
  ): Promise<"created" | "duplicate">;
}

export interface TransitionDestination {
  deliver(transition: SignalTransition, context: RunContext): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface FrameworkEvent {
  readonly name: string;
  readonly occurredAt: string;
  readonly runId: string;
  readonly fields: Readonly<Record<string, string | number | boolean | null>>;
}

export interface EventSink {
  emit(event: FrameworkEvent): void | Promise<void>;
}

export class ContractValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Contract validation failed: ${issues.join("; ")}`);
    this.name = "ContractValidationError";
    this.issues = issues;
  }
}

export class PortOperationError extends Error {
  readonly category: ErrorCategory;
  readonly retryable: boolean;

  constructor(message: string, category: ErrorCategory, retryable: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = "PortOperationError";
    this.category = category;
    this.retryable = retryable;
  }
}

const domainLabel = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const safeIdentifier = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const evidenceCode = /^[a-z][a-z0-9_]{0,63}$/;

export function normalizeDomain(input: string): string {
  const value = input.trim();
  if (value.length === 0) {
    throw new ContractValidationError(["domain is required"]);
  }

  let hostname: string;
  try {
    const candidate = value.includes("://") ? value : `https://${value}`;
    hostname = new URL(candidate).hostname.toLowerCase();
  } catch {
    throw new ContractValidationError(["domain must be a valid hostname or URL"]);
  }

  hostname = hostname.replace(/\.$/, "").replace(/^www\./, "");
  const labels = hostname.split(".");
  const isIpv4 = labels.length === 4 && labels.every((label) => /^\d{1,3}$/.test(label));
  if (
    hostname === "localhost" ||
    hostname.includes(":") ||
    isIpv4 ||
    labels.length < 2 ||
    labels.some((label) => !domainLabel.test(label))
  ) {
    throw new ContractValidationError(["domain must be a public DNS hostname"]);
  }

  return hostname;
}

export function validateAccount(input: Account): Account {
  const issues: string[] = [];
  if (!safeIdentifier.test(input.id)) issues.push("account id is invalid");
  if (input.displayName.trim().length === 0) issues.push("display name is required");
  if (!accountSegments.includes(input.segment)) issues.push("account segment is invalid");
  if (input.externalReferences !== undefined) {
    for (const reference of input.externalReferences) {
      if (!safeIdentifier.test(reference.system)) issues.push("external reference system is invalid");
      if (!safeIdentifier.test(reference.id)) issues.push("external reference id is invalid");
    }
    const referenceKeys = input.externalReferences.map(({ system, id }) => `${system}:${id}`);
    if (new Set(referenceKeys).size !== referenceKeys.length) {
      issues.push("external references must be unique");
    }
  }

  let domain = input.domain;
  try {
    domain = normalizeDomain(input.domain);
  } catch (error) {
    if (error instanceof ContractValidationError) issues.push(...error.issues);
    else throw error;
  }

  if (issues.length > 0) throw new ContractValidationError(issues);
  return { ...input, displayName: input.displayName.trim(), domain };
}

export function validateObservation(input: SignalObservation): SignalObservation {
  const issues: string[] = [];
  if (!safeIdentifier.test(input.accountId)) issues.push("observation account id is invalid");
  if (!safeIdentifier.test(input.detectorId)) issues.push("detector id is invalid");
  if (!detectorKinds.includes(input.detectorKind)) issues.push("detector kind is invalid");
  if (!observationStatuses.includes(input.status)) issues.push("observation status is invalid");
  if (!confidenceLevels.includes(input.confidence)) issues.push("observation confidence is invalid");
  if (Number.isNaN(Date.parse(input.observedAt))) issues.push("observation time is invalid");
  if (!safeIdentifier.test(input.fingerprint)) issues.push("observation fingerprint is invalid");
  if (input.evidenceCodes.some((code) => !evidenceCode.test(code))) {
    issues.push("observation evidence code is invalid");
  }
  if (issues.length > 0) throw new ContractValidationError(issues);
  return input;
}

export function validateConfig(input: CompetitiveFootprintConfig): CompetitiveFootprintConfig {
  const issues: string[] = [];
  if (input.detectorIds.length === 0) issues.push("at least one detector is required");
  if (new Set(input.detectorIds).size !== input.detectorIds.length) {
    issues.push("detector ids must be unique");
  }
  if (input.detectorIds.some((id) => !safeIdentifier.test(id))) issues.push("detector id is invalid");
  if (!Number.isInteger(input.lossConfirmationCount) || input.lossConfirmationCount < 1) {
    issues.push("loss confirmation count must be a positive integer");
  }
  if (input.cadence.length === 0) issues.push("at least one cadence rule is required");
  if (input.cadence.some((rule) => !Number.isFinite(rule.intervalHours) || rule.intervalHours <= 0)) {
    issues.push("cadence interval must be a positive number");
  }

  const cadenceKeys = input.cadence.map((rule) => `${rule.segment}:${rule.state}`);
  if (new Set(cadenceKeys).size !== cadenceKeys.length) issues.push("cadence rules must be unique");
  if (issues.length > 0) throw new ContractValidationError(issues);
  return input;
}
