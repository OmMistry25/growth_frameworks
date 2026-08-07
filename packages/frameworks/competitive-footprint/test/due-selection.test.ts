import assert from "node:assert/strict";
import test from "node:test";

import type { Account, CadenceRule, SignalState } from "@growth-frameworks/contracts/competitive-footprint";
import { ContractValidationError } from "@growth-frameworks/contracts/competitive-footprint";

import { selectDue } from "../src/due-selection.ts";

const account: Account = {
  id: "account:synthetic-1",
  displayName: "Synthetic Account",
  domain: "example.com",
  segment: "standard",
};

const cadence: readonly CadenceRule[] = [
  { segment: "standard", state: "confirmed", intervalHours: 72 },
];

test("an account without stored state is due immediately", () => {
  assert.deepEqual(selectDue(account, null, cadence, new Date("2026-08-07T12:00:00.000Z")), {
    due: true,
    dueAt: null,
  });
});

test("an account is due at the exact cadence boundary", () => {
  const result = selectDue(
    account,
    makeState("2026-08-04T12:00:00.000Z"),
    cadence,
    new Date("2026-08-07T12:00:00.000Z"),
  );

  assert.deepEqual(result, { due: true, dueAt: "2026-08-07T12:00:00.000Z" });
});

test("an account before its cadence boundary is not due", () => {
  const result = selectDue(
    account,
    makeState("2026-08-04T12:00:01.000Z"),
    cadence,
    new Date("2026-08-07T12:00:00.000Z"),
  );

  assert.deepEqual(result, { due: false, dueAt: "2026-08-07T12:00:01.000Z" });
});

test("missing cadence policy fails before selection", () => {
  assert.throws(
    () => selectDue(account, makeState("2026-08-04T12:00:00.000Z"), [], new Date()),
    ContractValidationError,
  );
});

function makeState(lastCheckedAt: string): SignalState {
  return {
    accountId: account.id,
    detectorId: "detector:dns",
    state: "confirmed",
    confidence: "high",
    lastCheckedAt,
    lastConclusiveObservationAt: lastCheckedAt,
    evidenceCodes: ["dns_match"],
    version: 1,
  };
}
