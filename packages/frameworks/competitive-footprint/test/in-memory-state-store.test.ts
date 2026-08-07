import assert from "node:assert/strict";
import test from "node:test";

import type { SignalObservation } from "@growth-frameworks/contracts/competitive-footprint";

import { InMemorySignalStateStore } from "../src/in-memory-state-store.ts";
import { decideTransition } from "../src/transition.ts";

const observation: SignalObservation = {
  accountId: "account:synthetic-1",
  detectorId: "detector:dns",
  detectorKind: "dns",
  observedAt: "2026-08-07T12:00:00.000Z",
  status: "positive",
  confidence: "high",
  evidenceCodes: ["dns_match"],
  fingerprint: "fingerprint:1",
};

test("records a state and its transition", async () => {
  const store = new InMemorySignalStateStore();
  const decision = decideTransition(null, observation, {
    lossCriteriaSatisfied: false,
    historicalEvidenceOnly: false,
  });

  assert.equal(await store.record(observation, decision.next, decision.transition), "created");
  assert.deepEqual(await store.get(observation.accountId, observation.detectorId), decision.next);
  assert.deepEqual(store.listTransitions(), [decision.transition]);
});

test("repeated operation is idempotent", async () => {
  const store = new InMemorySignalStateStore();
  const decision = decideTransition(null, observation, {
    lossCriteriaSatisfied: false,
    historicalEvidenceOnly: false,
  });

  assert.equal(await store.record(observation, decision.next, decision.transition), "created");
  assert.equal(await store.record(observation, decision.next, decision.transition), "duplicate");
  assert.equal(store.listTransitions().length, 1);
  assert.equal((await store.get(observation.accountId, observation.detectorId))?.version, 1);
});

test("rejects mismatched state without reserving the operation", async () => {
  const store = new InMemorySignalStateStore();
  const decision = decideTransition(null, observation, {
    lossCriteriaSatisfied: false,
    historicalEvidenceOnly: false,
  });
  const mismatched = { ...decision.next, accountId: "account:other" };

  await assert.rejects(() => store.record(observation, mismatched, decision.transition), /identity/);
  assert.equal(await store.record(observation, decision.next, decision.transition), "created");
});
