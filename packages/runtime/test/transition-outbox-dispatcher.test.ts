import assert from "node:assert/strict";
import test from "node:test";

import {
  PortOperationError,
  type PendingTransitionDelivery,
  type RunContext,
  type SignalTransition,
  type TransitionDestination,
  type TransitionOutbox,
} from "@growth-frameworks/contracts/competitive-footprint";

import { dispatchPendingTransitions } from "../src/transition-outbox-dispatcher.ts";

const context: RunContext = {
  runId: "dispatch:synthetic-1",
  startedAt: "2026-08-07T12:00:00.000Z",
  dryRun: false,
};

test("records an attempt before delivery and a receipt after success", async () => {
  const events: string[] = [];
  const outbox = new SyntheticOutbox([pending()], events);
  const destination = new SyntheticDestination(events);
  const result = await dispatchPendingTransitions(context, { limit: 10, maxAttempts: 3 }, {
    outbox,
    destination,
    clock: fixedClock(),
  });

  assert.deepEqual(events, ["attempt:transition:1", "deliver:transition:1", "receipt:transition:1"]);
  assert.deepEqual(result, {
    selected: 1,
    delivered: 1,
    retryableFailures: 0,
    terminalFailures: 0,
    exhausted: 0,
    skipped: 0,
    failures: [],
  });
});

test("leaves retryable and terminal delivery failures pending", async () => {
  for (const failure of [
    new PortOperationError("rate limited", "rate_limited", true),
    new PortOperationError("rejected", "permanent", false),
  ]) {
    const events: string[] = [];
    const outbox = new SyntheticOutbox([pending()], events);
    const destination = new SyntheticDestination(events, failure);
    const result = await dispatchPendingTransitions(context, { limit: 10, maxAttempts: 3 }, {
      outbox,
      destination,
      clock: fixedClock(),
    });
    assert.deepEqual(events, ["attempt:transition:1", "deliver:transition:1"]);
    assert.equal(result.delivered, 0);
    assert.equal(result.retryableFailures, failure.retryable ? 1 : 0);
    assert.equal(result.terminalFailures, failure.retryable ? 0 : 1);
    assert.equal(result.failures[0]?.duplicateRisk, false);
  }
});

test("does not call the destination after the lifetime attempt cap", async () => {
  const events: string[] = [];
  const outbox = new SyntheticOutbox([pending(3)], events);
  const result = await dispatchPendingTransitions(context, { limit: 10, maxAttempts: 3 }, {
    outbox,
    destination: new SyntheticDestination(events),
    clock: fixedClock(),
  });
  assert.equal(result.exhausted, 1);
  assert.deepEqual(events, []);
});

test("skips delivery when another dispatcher acquires the attempt", async () => {
  const events: string[] = [];
  const outbox = new SyntheticOutbox([pending()], events);
  outbox.attemptResult = "conflict";
  const result = await dispatchPendingTransitions(context, { limit: 10, maxAttempts: 3 }, {
    outbox,
    destination: new SyntheticDestination(events),
    clock: fixedClock(),
  });
  assert.deepEqual(events, ["attempt:transition:1"]);
  assert.equal(result.skipped, 1);
  assert.equal(result.delivered, 0);
});

test("reports receipt failures with duplicate risk", async () => {
  const events: string[] = [];
  const outbox = new SyntheticOutbox([pending()], events);
  outbox.receiptError = new PortOperationError("receipt unavailable", "conflict", true);
  const result = await dispatchPendingTransitions(context, { limit: 10, maxAttempts: 3 }, {
    outbox,
    destination: new SyntheticDestination(events),
    clock: fixedClock(),
  });
  assert.deepEqual(events, ["attempt:transition:1", "deliver:transition:1", "receipt:transition:1"]);
  assert.equal(result.retryableFailures, 1);
  assert.equal(result.failures[0]?.stage, "record_receipt");
  assert.equal(result.failures[0]?.duplicateRisk, true);
});

test("refuses dry runs and invalid bounds before reading the outbox", async () => {
  const outbox = new SyntheticOutbox([], []);
  const dependencies = { outbox, destination: new SyntheticDestination([]), clock: fixedClock() };
  await assert.rejects(
    () => dispatchPendingTransitions({ ...context, dryRun: true }, { limit: 10, maxAttempts: 3 }, dependencies),
    /disabled during dry run/,
  );
  await assert.rejects(() => dispatchPendingTransitions(context, { limit: 0, maxAttempts: 3 }, dependencies), /limit/);
  await assert.rejects(() => dispatchPendingTransitions(context, { limit: 10, maxAttempts: 11 }, dependencies), /attempts/);
  assert.equal(outbox.listCalls, 0);
});

function pending(attempts = 0): PendingTransitionDelivery {
  return { transition, attempts, lastAttemptAt: attempts === 0 ? null : "2026-08-07T11:00:00.000Z" };
}

const stateBase = {
  accountId: "account:synthetic-1",
  detectorId: "detector:dns",
  lastCheckedAt: "2026-08-07T12:00:00.000Z",
  lastConclusiveObservationAt: "2026-08-07T12:00:00.000Z",
  evidenceCodes: ["dns_match"],
} as const;
const transition: SignalTransition = {
  idempotencyKey: "transition:1",
  kind: "detected",
  accountId: stateBase.accountId,
  detectorId: stateBase.detectorId,
  occurredAt: "2026-08-07T12:00:00.000Z",
  previous: { ...stateBase, state: "unknown", confidence: null, version: 0 },
  next: { ...stateBase, state: "confirmed", confidence: "high", version: 1 },
};

class SyntheticOutbox implements TransitionOutbox {
  listCalls = 0;
  receiptError: Error | undefined;
  attemptResult: "recorded" | "missing" | "delivered" | "conflict" = "recorded";
  readonly #pending: readonly PendingTransitionDelivery[];
  readonly #events: string[];

  constructor(pendingItems: readonly PendingTransitionDelivery[], events: string[]) {
    this.#pending = pendingItems;
    this.#events = events;
  }

  async listPending(limit: number) {
    this.listCalls += 1;
    return this.#pending.slice(0, limit);
  }

  async recordAttempt(idempotencyKey: string, _expectedAttempts: number) {
    this.#events.push(`attempt:${idempotencyKey}`);
    return this.attemptResult;
  }

  async markDelivered(idempotencyKey: string) {
    this.#events.push(`receipt:${idempotencyKey}`);
    if (this.receiptError !== undefined) throw this.receiptError;
    return "recorded" as const;
  }
}

class SyntheticDestination implements TransitionDestination {
  readonly #events: string[];
  readonly #error: Error | undefined;

  constructor(events: string[], error?: Error) {
    this.#events = events;
    this.#error = error;
  }

  async deliver(item: SignalTransition) {
    this.#events.push(`deliver:${item.idempotencyKey}`);
    if (this.#error !== undefined) throw this.#error;
  }
}

function fixedClock() {
  return { now: () => new Date("2026-08-07T12:01:00.000Z") };
}
