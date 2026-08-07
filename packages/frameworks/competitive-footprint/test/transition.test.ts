import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type {
  Confidence,
  ObservationStatus,
  SignalObservation,
  SignalStateName,
  TransitionKind,
} from "@growth-frameworks/contracts/competitive-footprint";

import { createUnknownState, decideTransition } from "../src/transition.ts";

interface TransitionFixtureCase {
  readonly id: string;
  readonly behavior: "state_transition";
  readonly priorState: SignalStateName;
  readonly observation: {
    readonly status: ObservationStatus;
    readonly confidence: Confidence;
    readonly evidenceCodes: readonly string[];
  };
  readonly policy?: {
    readonly lossCriteriaSatisfied: boolean;
    readonly historicalEvidenceOnly: boolean;
  };
  readonly expected: {
    readonly state: SignalStateName;
    readonly transition: TransitionKind;
  };
}

interface ParityFixture {
  readonly cases: readonly (TransitionFixtureCase | { readonly behavior: string })[];
}

const fixtureUrl = new URL("./fixtures/parity-cases.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as ParityFixture;
const transitionCases = fixture.cases.filter(
  (candidate): candidate is TransitionFixtureCase => candidate.behavior === "state_transition",
);

for (const fixtureCase of transitionCases) {
  test(`parity transition: ${fixtureCase.id}`, () => {
    const observation = makeObservation(fixtureCase.observation);
    const prior = {
      ...createUnknownState(observation.accountId, observation.detectorId),
      state: fixtureCase.priorState,
      confidence: fixtureCase.priorState === "unknown" ? null : "medium",
      lastCheckedAt: "2026-08-06T12:00:00.000Z",
      lastConclusiveObservationAt: "2026-08-06T12:00:00.000Z",
      evidenceCodes: fixtureCase.priorState === "unknown" ? [] : ["prior_signal"],
      version: fixtureCase.priorState === "unknown" ? 0 : 1,
    } as const;

    const decision = decideTransition(prior, observation, fixtureCase.policy ?? defaultPolicy);

    assert.equal(decision.next.state, fixtureCase.expected.state);
    assert.equal(decision.transition?.kind ?? "none", fixtureCase.expected.transition);
  });
}

test("indeterminate observation updates check time without creating a state version", () => {
  const observation = makeObservation({
    status: "indeterminate",
    confidence: "low",
    evidenceCodes: ["probe_timeout"],
  });
  const prior = {
    ...createUnknownState(observation.accountId, observation.detectorId),
    state: "confirmed",
    confidence: "high",
    lastCheckedAt: "2026-08-06T12:00:00.000Z",
    lastConclusiveObservationAt: "2026-08-06T12:00:00.000Z",
    evidenceCodes: ["dns_match"],
    version: 4,
  } as const;

  const decision = decideTransition(prior, observation, defaultPolicy);

  assert.equal(decision.next.version, 4);
  assert.equal(decision.next.lastCheckedAt, observation.observedAt);
  assert.equal(decision.next.lastConclusiveObservationAt, prior.lastConclusiveObservationAt);
  assert.equal(decision.transition, null);
});

test("rejects an observation for a different state identity", () => {
  const observation = makeObservation({
    status: "positive",
    confidence: "high",
    evidenceCodes: ["dns_match"],
  });
  const prior = createUnknownState("account:other", observation.detectorId);

  assert.throws(
    () => decideTransition(prior, observation, defaultPolicy),
    /identity does not match/,
  );
});

const defaultPolicy = {
  lossCriteriaSatisfied: false,
  historicalEvidenceOnly: false,
} as const;

function makeObservation(
  values: Pick<SignalObservation, "status" | "confidence" | "evidenceCodes">,
): SignalObservation {
  return {
    accountId: "account:synthetic-1",
    detectorId: "detector:dns",
    detectorKind: "dns",
    observedAt: "2026-08-07T12:00:00.000Z",
    fingerprint: `fingerprint:${values.status}:${values.confidence}`,
    ...values,
  };
}
