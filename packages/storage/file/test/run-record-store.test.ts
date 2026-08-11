import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RunRecord } from "@growth-frameworks/contracts/competitive-footprint";

import { FileRunRecordStore } from "../src/run-record-store.ts";

const record: RunRecord = {
  schemaVersion: 1,
  framework: "competitive-footprint",
  mode: "network-stateful",
  runId: "network-stateful:2026-08-10T12:00:00.000Z",
  startedAt: "2026-08-10T12:00:00.000Z",
  recordedAt: "2026-08-10T12:00:01.000Z",
  dryRun: false,
  status: "succeeded",
  counts: { selected: 3, processed: 3, changed: 2, unchanged: 1, skipped: 0, failed: 0 },
  failureCategories: { validation: 0, authorization: 0, rate_limited: 0, transient: 0, permanent: 0, conflict: 0 },
};

test("atomically creates secret-safe immutable run records", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "growth-frameworks-runs-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "records");
  const store = new FileRunRecordStore({ directory, allowWrite: true });

  assert.equal(await store.record(record), "created");
  assert.equal(await store.record(record), "duplicate");
  const entries = await readdir(directory);
  assert.equal(entries.length, 1);
  const path = join(directory, entries[0]!);
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), record);
  assert.equal((await lstat(directory)).mode & 0o777, 0o700);
});

test("rejects conflicting content for an existing run identity", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "growth-frameworks-runs-conflict-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = new FileRunRecordStore({ directory, allowWrite: true });
  await store.record(record);
  await assert.rejects(() => store.record({ ...record, status: "failed" }), /different content/);
});

test("rejects unsafe records and symbolic-link directories", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "growth-frameworks-runs-unsafe-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "target");
  const link = join(root, "link");
  await mkdir(target);
  await symlink(target, link);
  const store = new FileRunRecordStore({ directory: link, allowWrite: true });
  await assert.rejects(() => store.record(record), /symbolic link/);
  await assert.rejects(
    () => new FileRunRecordStore({ directory: target, allowWrite: true }).record({ ...record, runId: "private/customer/path" }),
    /run record id is invalid/,
  );
});
