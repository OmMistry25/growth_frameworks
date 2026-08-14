import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RunRecord, RunStatus } from "@growth-frameworks/contracts/competitive-footprint";

import {
  compilePilotEvidence,
  main,
  parsePilotEvidenceArgs,
  type PilotEvidenceOptions,
} from "../src/competitive-footprint-pilot-evidence.ts";

test("compiles repository-safe aggregate evidence without mutation", async (context) => {
  const fixture = await createFixture(context, 2);
  const report = await compilePilotEvidence(fixture.options);

  assert.equal(report.status, "in_progress");
  assert.deepEqual(report.windows, { expected: 5, completed: 2, remaining: 3 });
  assert.deepEqual(report.totals, {
    selected: 18,
    processed: 18,
    changed: 1,
    unchanged: 17,
    skipped: 0,
    failed: 0,
  });
  assert.deepEqual(report.backups, { verified: 2, complete: true });
  assert.equal(report.controls.zeroDeliveryAttempts, true);
  assert.equal(report.controls.zeroDeliveries, true);
  assert.deepEqual(report.outbox, {
    schemaVersion: 2,
    sourceSchemaVersion: 2,
    states: 0,
    operations: 0,
    transitions: 0,
    pending: 0,
    deliverable: 0,
    exhausted: 0,
    delivered: 0,
    neverAttempted: 0,
    attemptedPending: 0,
  });
  const output = JSON.stringify(report);
  assert.doesNotMatch(output, /synthetic|private|\.json|\/tmp|account|domain|detector/i);
  assert.deepEqual(await readFile(fixture.options.statePath, "utf8"), fixture.initialState);
});

test("becomes ready only after the expected successful backed-up windows", async (context) => {
  const fixture = await createFixture(context, 5);
  const report = await compilePilotEvidence(fixture.options);
  assert.equal(report.status, "ready_for_review");
  assert.equal(report.windows.remaining, 0);
  assert.equal(report.controls.runRecordsComplete, true);
  assert.equal(report.controls.backupsComplete, true);
});

test("reports attention for failures or incomplete backups", async (context) => {
  const fixture = await createFixture(context, 2, { secondStatus: "partial_failure", backupCount: 1 });
  const report = await compilePilotEvidence(fixture.options);
  assert.equal(report.status, "attention");
  assert.equal(report.controls.allRunsSucceeded, false);
  assert.equal(report.controls.backupsComplete, false);
  assert.equal(report.totals.failed, 1);
  assert.equal(report.failureCategories.transient, 1);
});

test("requires an explicit read-only gate and rejects side-effect arguments", () => {
  const required = [
    "--pilot-evidence",
    "--state-file", "/secure/state.json",
    "--run-record-dir", "/secure/runs",
    "--backup-dir", "/secure/backups",
  ];
  const parsed = parsePilotEvidenceArgs(required);
  assert.equal(parsed.expectedWindows, 5);
  assert.equal(parsed.maxAttempts, 3);
  assert.throws(() => parsePilotEvidenceArgs(required.filter((value) => value !== "--pilot-evidence")), /exactly once/);
  assert.throws(() => parsePilotEvidenceArgs([...required, "--allow-network"]), /Unknown argument/);
  assert.throws(() => parsePilotEvidenceArgs([...required, "--allow-state-write"]), /Unknown argument/);
  assert.throws(() => parsePilotEvidenceArgs([...required, "--webhook"]), /Unknown argument/);
});

test("fails closed on unsafe storage and mismatched record identities", async (context) => {
  const fixture = await createFixture(context, 2);
  await chmod(fixture.options.statePath, 0o644);
  await assert.rejects(() => compilePilotEvidence(fixture.options), /permissions/);
  await chmod(fixture.options.statePath, 0o600);

  const records = (await import("node:fs/promises")).readdir;
  const names = (await records(fixture.options.runRecordDirectory)).sort();
  const first = await readFile(join(fixture.options.runRecordDirectory, names[0]!), "utf8");
  await writeSecure(join(fixture.options.runRecordDirectory, names[1]!), first);
  await assert.rejects(() => compilePilotEvidence(fixture.options), /immutable identity/);
});

test("rejects duplicate backup coverage", async (context) => {
  const fixture = await createFixture(context, 2);
  const firstBackup = join(fixture.options.backupDirectory, "window-1", "run-record.json");
  const secondBackup = join(fixture.options.backupDirectory, "window-2", "run-record.json");
  await writeSecure(secondBackup, await readFile(firstBackup, "utf8"));
  await assert.rejects(() => compilePilotEvidence(fixture.options), /duplicate run record/);
});

test("rejects symbolic-link backup windows", async (context) => {
  const fixture = await createFixture(context, 1);
  const target = join(fixture.root, "alternate-backup");
  await mkdir(target, { mode: 0o700 });
  await symlink(target, join(fixture.options.backupDirectory, "linked-window"));
  await assert.rejects(() => compilePilotEvidence(fixture.options), /regular directory/);
});

test("CLI refuses invalid input before invoking its runner", async () => {
  let executed = false;
  let error = "";
  const exitCode = await main(
    ["--pilot-evidence"],
    () => undefined,
    (value) => { error += value; },
    async () => {
      executed = true;
      throw new Error("runner must not execute");
    },
  );
  assert.equal(exitCode, 1);
  assert.equal(executed, false);
  assert.match(error, /--state-file must appear once/);
});

async function createFixture(
  context: test.TestContext,
  recordCount: number,
  overrides: { readonly secondStatus?: RunStatus; readonly backupCount?: number } = {},
): Promise<{ readonly root: string; readonly options: PilotEvidenceOptions; readonly initialState: string }> {
  const root = await mkdtemp(join(tmpdir(), "growth-frameworks-pilot-evidence-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const runRecordDirectory = join(root, "private-runs");
  const backupDirectory = join(root, "private-backups");
  await Promise.all([
    mkdir(runRecordDirectory, { mode: 0o700 }),
    mkdir(backupDirectory, { mode: 0o700 }),
  ]);
  const statePath = join(root, "private-state.json");
  const initialState = `${JSON.stringify({ schemaVersion: 2, sourceSchemaVersion: 2, states: [], operations: [] }, null, 2)}\n`;
  await writeSecure(statePath, initialState);

  const serializedRecords: string[] = [];
  for (let index = 0; index < recordCount; index += 1) {
    const status = index === 1 && overrides.secondStatus !== undefined ? overrides.secondStatus : "succeeded";
    const record = makeRecord(index, status);
    const serialized = `${JSON.stringify(record, null, 2)}\n`;
    serializedRecords.push(serialized);
    const name = `${createHash("sha256").update(record.runId).digest("hex")}.json`;
    await writeSecure(join(runRecordDirectory, name), serialized);
  }
  const backupCount = overrides.backupCount ?? recordCount;
  for (let index = 0; index < backupCount; index += 1) {
    const directory = join(backupDirectory, `window-${index + 1}`);
    await mkdir(directory, { mode: 0o700 });
    await Promise.all([
      writeSecure(join(directory, "state.json"), initialState),
      writeSecure(join(directory, "run-record.json"), serializedRecords[index]!),
    ]);
  }
  return {
    root,
    initialState,
    options: {
      statePath,
      runRecordDirectory,
      backupDirectory,
      expectedWindows: 5,
      maxAttempts: 3,
      pilotEvidence: true,
    },
  };
}

function makeRecord(index: number, status: RunStatus): RunRecord {
  const startedAt = `2026-08-${String(10 + index).padStart(2, "0")}T01:00:00.000Z`;
  const failed = status === "succeeded" ? 0 : 1;
  return {
    schemaVersion: 1,
    framework: "competitive-footprint",
    mode: "network-stateful",
    runId: `network-stateful:${startedAt}`,
    startedAt,
    recordedAt: startedAt,
    dryRun: false,
    status,
    counts: {
      selected: 9,
      processed: 9 - failed,
      changed: index === 0 ? 1 : 0,
      unchanged: 8 - failed + (index === 0 ? 0 : 1),
      skipped: 0,
      failed,
    },
    failureCategories: {
      validation: 0,
      authorization: 0,
      rate_limited: 0,
      transient: failed,
      permanent: 0,
      conflict: 0,
    },
  };
}

async function writeSecure(path: string, value: string): Promise<void> {
  await writeFile(path, value, { mode: 0o600 });
  await chmod(path, 0o600);
}
