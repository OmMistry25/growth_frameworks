import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import type { SignalObservation } from "@growth-frameworks/contracts/competitive-footprint";
import { decideTransition } from "@growth-frameworks/competitive-footprint";

import { FileSignalStateStore } from "../src/signal-state-store.ts";

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

test("requires explicit write authorization", () => {
  assert.throws(
    () => new FileSignalStateStore({ path: "/tmp/state.json" } as never),
    /access mode requires explicit authorization/,
  );
});

test("read-only mode inspects aggregates and rejects every mutation", async (context) => {
  const path = await statePath(context);
  const decision = decideTransition(null, observation, {
    lossCriteriaSatisfied: false,
    historicalEvidenceOnly: false,
  });
  assert.ok(decision.transition !== null);
  const writer = new FileSignalStateStore({ path, allowWrite: true });
  await writer.record(observation, decision.next, decision.transition);
  await writer.recordAttempt(decision.transition.idempotencyKey, 0, "2026-08-07T12:01:00.000Z");

  const reader = new FileSignalStateStore({ path, readOnly: true });
  assert.deepEqual(await reader.inspectOutbox(1), {
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
  });
  await assert.rejects(() => reader.record(observation, decision.next, decision.transition), /writes require explicit authorization/);
  await assert.rejects(
    () => reader.recordAttempt(decision.transition!.idempotencyKey, 1, "2026-08-07T12:02:00.000Z"),
    /writes require explicit authorization/,
  );
  await assert.rejects(
    () => reader.markDelivered(decision.transition!.idempotencyKey, "2026-08-07T12:02:00.000Z"),
    /writes require explicit authorization/,
  );
});

test("pending reads and inspection fail closed when the file is missing", async (context) => {
  const path = await statePath(context);
  const reader = new FileSignalStateStore({ path, readOnly: true });
  await assert.rejects(() => reader.listPending(1), /does not exist/);
  await assert.rejects(() => reader.inspectOutbox(3), /does not exist/);
});

test("persists state and idempotency across instances", async (context) => {
  const path = await statePath(context);
  const decision = decideTransition(null, observation, {
    lossCriteriaSatisfied: false,
    historicalEvidenceOnly: false,
  });
  const first = new FileSignalStateStore({ path, allowWrite: true });
  assert.equal(await first.record(observation, decision.next, decision.transition), "created");

  const reopened = new FileSignalStateStore({ path, allowWrite: true });
  assert.deepEqual(await reopened.get(observation.accountId, observation.detectorId), decision.next);
  assert.equal(await reopened.record(observation, decision.next, decision.transition), "duplicate");
  assert.equal((await stat(path)).mode & 0o777, 0o600);

  const document = JSON.parse(await readFile(path, "utf8")) as { operations: unknown[] };
  assert.equal(document.operations.length, 1);
});

test("persists pending delivery attempts and receipts across instances", async (context) => {
  const path = await statePath(context);
  const decision = decideTransition(null, observation, {
    lossCriteriaSatisfied: false,
    historicalEvidenceOnly: false,
  });
  assert.ok(decision.transition !== null);
  const store = new FileSignalStateStore({ path, allowWrite: true });
  await store.record(observation, decision.next, decision.transition);
  assert.deepEqual(await store.listPending(10), [{
    transition: decision.transition,
    attempts: 0,
    lastAttemptAt: null,
  }]);

  assert.equal(await store.recordAttempt(decision.transition.idempotencyKey, 0, "2026-08-07T12:01:00.000Z"), "recorded");
  const reopened = new FileSignalStateStore({ path, allowWrite: true });
  assert.deepEqual(await reopened.listPending(10), [{
    transition: decision.transition,
    attempts: 1,
    lastAttemptAt: "2026-08-07T12:01:00.000Z",
  }]);
  assert.equal(await reopened.markDelivered(decision.transition.idempotencyKey, "2026-08-07T12:02:00.000Z"), "recorded");
  assert.deepEqual(await reopened.listPending(10), []);
  assert.equal(await reopened.markDelivered(decision.transition.idempotencyKey, "2026-08-07T12:03:00.000Z"), "duplicate");
  assert.equal(await reopened.recordAttempt(decision.transition.idempotencyKey, 1, "2026-08-07T12:03:00.000Z"), "delivered");
});

test("upgrades schema v1 transitions to pending outbox entries", async (context) => {
  const path = await statePath(context);
  await mkdir(dirname(path), { recursive: true });
  const decision = decideTransition(null, observation, {
    lossCriteriaSatisfied: false,
    historicalEvidenceOnly: false,
  });
  assert.ok(decision.transition !== null);
  await writeFile(path, `${JSON.stringify({
    schemaVersion: 1,
    states: [decision.next],
    operations: [{
      key: "legacy-operation",
      observation,
      transition: decision.transition,
    }],
  })}\n`, { mode: 0o600 });

  const store = new FileSignalStateStore({ path, allowWrite: true });
  assert.equal((await store.inspectOutbox(3)).sourceSchemaVersion, 1);
  assert.equal((await store.listPending(10))[0]?.transition.idempotencyKey, decision.transition.idempotencyKey);
  await store.recordAttempt(decision.transition.idempotencyKey, 0, "2026-08-07T12:01:00.000Z");
  const document = JSON.parse(await readFile(path, "utf8")) as { schemaVersion: number };
  assert.equal(document.schemaVersion, 2);
});

test("validates outbox limits, timestamps, and missing keys", async (context) => {
  const store = new FileSignalStateStore({ path: await statePath(context), allowWrite: true });
  await assert.rejects(() => store.listPending(0), /limit/);
  await assert.rejects(() => store.recordAttempt("missing", 0, "not-a-time"), /attempt time/);
  await assert.rejects(() => store.markDelivered("missing", "not-a-time"), /delivery time/);
  assert.equal(await store.recordAttempt("missing", 0, "2026-08-07T12:01:00.000Z"), "missing");
  assert.equal(await store.markDelivered("missing", "2026-08-07T12:01:00.000Z"), "missing");
});

test("requires an attempt before a chronologically valid receipt", async (context) => {
  const store = new FileSignalStateStore({ path: await statePath(context), allowWrite: true });
  const decision = decideTransition(null, observation, {
    lossCriteriaSatisfied: false,
    historicalEvidenceOnly: false,
  });
  assert.ok(decision.transition !== null);
  await store.record(observation, decision.next, decision.transition);
  await assert.rejects(
    () => store.markDelivered(decision.transition!.idempotencyKey, "2026-08-07T12:01:00.000Z"),
    /attempt must be recorded/,
  );
  await store.recordAttempt(decision.transition.idempotencyKey, 0, "2026-08-07T12:02:00.000Z");
  await assert.rejects(
    () => store.markDelivered(decision.transition!.idempotencyKey, "2026-08-07T12:01:00.000Z"),
    /cannot precede/,
  );
});

test("acquires an attempt with optimistic concurrency", async (context) => {
  const store = new FileSignalStateStore({ path: await statePath(context), allowWrite: true });
  const decision = decideTransition(null, observation, {
    lossCriteriaSatisfied: false,
    historicalEvidenceOnly: false,
  });
  assert.ok(decision.transition !== null);
  await store.record(observation, decision.next, decision.transition);
  assert.equal(
    await store.recordAttempt(decision.transition.idempotencyKey, 0, "2026-08-07T12:01:00.000Z"),
    "recorded",
  );
  assert.equal(
    await store.recordAttempt(decision.transition.idempotencyKey, 0, "2026-08-07T12:01:01.000Z"),
    "conflict",
  );
  assert.equal((await store.listPending(1))[0]?.attempts, 1);
});

test("serializes competing writers with a retryable conflict", async (context) => {
  const path = await statePath(context);
  await mkdir(dirname(path), { recursive: true });
  await mkdir(`${path}.lock`);
  const store = new FileSignalStateStore({ path, allowWrite: true });
  const decision = decideTransition(null, observation, {
    lossCriteriaSatisfied: false,
    historicalEvidenceOnly: false,
  });
  await assert.rejects(
    () => store.record(observation, decision.next, decision.transition),
    (error: unknown) => error instanceof Error && "retryable" in error && error.retryable === true,
  );
});

test("fails closed for corrupted state", async (context) => {
  const path = await statePath(context);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "{not-json", "utf8");
  const store = new FileSignalStateStore({ path, allowWrite: true });
  await assert.rejects(() => store.get("account:synthetic-1", "detector:dns"), /invalid or corrupted/);
});

test("rejects a symbolic-link state target", async (context) => {
  const directory = await temporaryDirectory(context);
  const target = join(directory, "target.json");
  const path = join(directory, "state.json");
  await writeFile(target, "{}", "utf8");
  await symlink(target, path);
  const store = new FileSignalStateStore({ path, allowWrite: true });
  await assert.rejects(() => store.get("account:synthetic-1", "detector:dns"), /symbolic link/);
});

async function statePath(context: test.TestContext): Promise<string> {
  return join(await temporaryDirectory(context), "nested", "state.json");
}

async function temporaryDirectory(context: test.TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "growth-frameworks-state-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}
