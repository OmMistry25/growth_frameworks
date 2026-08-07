import assert from "node:assert/strict";
import test from "node:test";

import { main, runSyntheticCompetitiveFootprintDryRun } from "../src/competitive-footprint-dry-run.ts";

const runAt = "2026-08-07T12:00:00.000Z";

test("synthetic dry run composes all detectors without writes", async () => {
  const report = await runSyntheticCompetitiveFootprintDryRun(runAt);

  assert.equal(report.mode, "dry-run");
  assert.equal(report.fixture, "synthetic");
  assert.equal(report.result.status, "succeeded");
  assert.deepEqual(
    {
      selected: report.result.selected,
      processed: report.result.processed,
      changed: report.result.changed,
      failed: report.result.failed,
    },
    { selected: 3, processed: 3, changed: 3, failed: 0 },
  );
  assert.equal(report.result.intents.length, 6);
  assert.ok(report.result.intents.every(({ dryRun }) => dryRun));
  assert.deepEqual(
    new Set(report.result.intents.map(({ detectorId }) => detectorId)),
    new Set(["detector:synthetic-dns", "detector:synthetic-subdomain", "detector:synthetic-tcp"]),
  );
});

test("CLI writes structured JSON and exits successfully", async () => {
  let output = "";
  let error = "";
  const exitCode = await main(
    ["--at", runAt],
    (value) => {
      output += value;
    },
    (value) => {
      error += value;
    },
  );

  assert.equal(exitCode, 0);
  assert.equal(error, "");
  assert.equal(JSON.parse(output).result.runId, `dry-run:${runAt}`);
});

test("CLI rejects an invalid timestamp without a stack trace", async () => {
  let error = "";
  const exitCode = await main(["--at", "not-a-date"], () => undefined, (value) => {
    error += value;
  });

  assert.equal(exitCode, 1);
  assert.equal(error, "Dry-run time must be a valid ISO timestamp\n");
});

test("CLI rejects unknown arguments", async () => {
  let error = "";
  const exitCode = await main(["--live"], () => undefined, (value) => {
    error += value;
  });

  assert.equal(exitCode, 1);
  assert.equal(error, "Unknown dry-run argument\n");
});
