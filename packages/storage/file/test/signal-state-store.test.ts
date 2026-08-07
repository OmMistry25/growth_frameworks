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
    () => new FileSignalStateStore({ path: "/tmp/state.json", allowWrite: false } as never),
    /explicit authorization/,
  );
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
