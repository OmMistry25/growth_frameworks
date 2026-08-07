import type {
  SignalObservation,
  SignalState,
  SignalStateName,
  SignalTransition,
  TransitionKind,
} from "@growth-frameworks/contracts/competitive-footprint";
import { validateObservation } from "@growth-frameworks/contracts/competitive-footprint";

export interface TransitionPolicy {
  readonly lossCriteriaSatisfied: boolean;
  readonly historicalEvidenceOnly: boolean;
}

export interface TransitionDecision {
  readonly next: SignalState;
  readonly transition: SignalTransition | null;
}

const confidenceRank = {
  low: 0,
  medium: 1,
  high: 2,
} as const;

export function createUnknownState(accountId: string, detectorId: string): SignalState {
  return {
    accountId,
    detectorId,
    state: "unknown",
    confidence: null,
    lastCheckedAt: null,
    lastConclusiveObservationAt: null,
    evidenceCodes: [],
    version: 0,
  };
}

export function createOperationKey(observation: SignalObservation): string {
  return [
    "competitive-footprint",
    observation.accountId,
    observation.detectorId,
    observation.observedAt,
    observation.fingerprint,
  ].join(":");
}

export function decideTransition(
  priorInput: SignalState | null,
  observationInput: SignalObservation,
  policy: TransitionPolicy,
): TransitionDecision {
  const observation = validateObservation(observationInput);
  const prior = priorInput ?? createUnknownState(observation.accountId, observation.detectorId);
  assertMatchingIdentity(prior, observation);

  if (observation.status === "indeterminate") {
    return {
      next: {
        ...prior,
        lastCheckedAt: observation.observedAt,
      },
      transition: null,
    };
  }

  const outcome = decideConclusiveOutcome(prior, observation, policy);
  const next = buildNextState(prior, observation, outcome.state);
  const transition =
    outcome.kind === "none"
      ? null
      : {
          idempotencyKey: createOperationKey(observation),
          kind: outcome.kind,
          accountId: observation.accountId,
          detectorId: observation.detectorId,
          occurredAt: observation.observedAt,
          previous: prior,
          next,
        };

  return { next, transition };
}

function decideConclusiveOutcome(
  prior: SignalState,
  observation: SignalObservation,
  policy: TransitionPolicy,
): { readonly state: SignalStateName; readonly kind: TransitionKind } {
  if (observation.status === "positive") {
    if (prior.state === "historical" || prior.state === "lost") {
      return { state: "confirmed", kind: "restored" };
    }

    const observedState = observation.confidence === "low" ? "possible" : "confirmed";
    if (prior.state === "unknown") return { state: observedState, kind: "detected" };
    if (prior.state === "possible" && observedState === "confirmed") {
      return { state: "confirmed", kind: "confidence_upgraded" };
    }
    if (prior.state === "confirmed") return { state: "confirmed", kind: "none" };
    return { state: "possible", kind: "none" };
  }

  if (prior.state === "possible") return { state: "unknown", kind: "cleared" };
  if (prior.state !== "confirmed") return { state: prior.state, kind: "none" };
  if (policy.historicalEvidenceOnly) return { state: "historical", kind: "signal_changed" };
  if (policy.lossCriteriaSatisfied) return { state: "lost", kind: "lost" };
  return { state: "confirmed", kind: "none" };
}

function buildNextState(
  prior: SignalState,
  observation: SignalObservation,
  state: SignalStateName,
): SignalState {
  const confidence = state === "unknown" ? null : observation.confidence;
  const changed =
    state !== prior.state ||
    confidence !== prior.confidence ||
    !sameEvidence(prior.evidenceCodes, observation.evidenceCodes);

  return {
    accountId: prior.accountId,
    detectorId: prior.detectorId,
    state,
    confidence,
    lastCheckedAt: observation.observedAt,
    lastConclusiveObservationAt: observation.observedAt,
    evidenceCodes: [...observation.evidenceCodes],
    version: changed ? prior.version + 1 : prior.version,
  };
}

function sameEvidence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertMatchingIdentity(prior: SignalState, observation: SignalObservation): void {
  if (prior.accountId !== observation.accountId || prior.detectorId !== observation.detectorId) {
    throw new Error("Observation identity does not match prior signal state");
  }
}

export function isConfidenceUpgrade(previous: SignalState, next: SignalState): boolean {
  if (previous.confidence === null || next.confidence === null) return false;
  return confidenceRank[next.confidence] > confidenceRank[previous.confidence];
}
