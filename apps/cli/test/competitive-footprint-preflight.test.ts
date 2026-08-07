import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { SignalObservation } from "@growth-frameworks/contracts/competitive-footprint";
import { decideTransition } from "@growth-frameworks/competitive-footprint";
import { FileSignalStateStore } from "@growth-frameworks/file-state-store";

import {
  main,
  parsePreflightArgs,
  runPreflight,
} from "../src/competitive-footprint-preflight.ts";

test("preflight reports aggregate pending state without mutation", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "growth-frameworks-preflight-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const statePath = join(directory, "state.json");
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
  const decision = decideTransition(null, observation, {
    lossCriteriaSatisfied: false,
    historicalEvidenceOnly: false,
  });
  const writer = new FileSignalStateStore({ path: statePath, allowWrite: true });
  await writer.record(observation, decision.next, decision.transition);

  const report = await runPreflight({ statePath, maxAttempts: 3 });
  assert.equal(report.status, "ready");
  assert.equal(report.readOnly, true);
  assert.deepEqual(
    { pending: report.outbox.pending, deliverable: report.outbox.deliverable, exhausted: report.outbox.exhausted },
    { pending: 1, deliverable: 1, exhausted: 0 },
  );
  assert.equal(JSON.stringify(report).includes("account:synthetic-1"), false);
});

test("parser requires one state file and validates numeric syntax", () => {
  assert.throws(() => parsePreflightArgs([]), /--state-file must appear once/);
  assert.throws(
    () => parsePreflightArgs(["--state-file", "one", "--state-file", "two"]),
    /--state-file must appear once/,
  );
  assert.throws(
    () => parsePreflightArgs(["--state-file", "state.json", "--max-attempts", "1.5"]),
    /must be an integer/,
  );
  assert.throws(
    () => parsePreflightArgs(["--state-file", "state.json", "unexpected"]),
    /Unknown argument/,
  );
});

test("CLI returns nonzero for attention status", async () => {
  let output = "";
  const exitCode = await main(
    ["--state-file", "state.json"],
    (value) => { output += value; },
    () => undefined,
    async () => ({
      command: "competitive-footprint",
      mode: "outbox-preflight",
      readOnly: true,
      status: "attention",
      outbox: {
        schemaVersion: 2,
        sourceSchemaVersion: 2,
        states: 1,
        operations: 1,
        transitions: 1,
        pending: 1,
        deliverable: 0,
        exhausted: 1,
        delivered: 0,
        neverAttempted: 0,
        attemptedPending: 1,
      },
    }),
  );
  assert.equal(exitCode, 1);
  assert.match(output, /"status": "attention"/);
});
