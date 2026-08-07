import assert from "node:assert/strict";
import test from "node:test";

import type {
  Account,
  AccountSource,
  CompetitiveFootprintConfig,
  RunContext,
  SignalDetector,
  SignalObservation,
  SignalState,
  SignalStateStore,
  SignalTransition,
  TransitionDestination,
} from "@growth-frameworks/contracts/competitive-footprint";

import { InMemorySignalStateStore } from "../src/in-memory-state-store.ts";
import {
  FrameworkOperationError,
  runCompetitiveFootprint,
  type CompetitiveFootprintDependencies,
} from "../src/orchestrator.ts";

const account: Account = {
  id: "account:synthetic-1",
  displayName: "Synthetic Account",
  domain: "example.com",
  segment: "standard",
};

const context: RunContext = {
  runId: "run:synthetic-1",
  startedAt: "2026-08-07T12:00:00.000Z",
  dryRun: false,
};

const config: CompetitiveFootprintConfig = {
  detectorIds: ["detector:dns"],
  cadence: [
    { segment: "standard", state: "unknown", intervalHours: 24 },
    { segment: "standard", state: "confirmed", intervalHours: 72 },
  ],
  lossConfirmationCount: 2,
};

test("persists a new detection before delivering it", async () => {
  const operations: string[] = [];
  const store = new RecordingStore(operations);
  const destination = new RecordingDestination(operations);

  const result = await runCompetitiveFootprint(context, config, {
    ...makeDependencies(),
    stateStore: store,
    destinations: [destination],
  });

  assert.equal(result.status, "succeeded");
  assert.deepEqual(
    pickCounts(result),
    { selected: 1, processed: 1, changed: 1, unchanged: 0, skipped: 0, failed: 0 },
  );
  assert.deepEqual(operations, ["persist", "deliver"]);
  assert.equal(result.intents.length, 2);
  assert.ok(result.intents.every((intent) => !intent.dryRun));
});

test("dry run produces intents without persistence or delivery", async () => {
  const operations: string[] = [];
  const result = await runCompetitiveFootprint(
    { ...context, dryRun: true },
    config,
    {
      ...makeDependencies(),
      stateStore: new RecordingStore(operations),
      destinations: [new RecordingDestination(operations)],
    },
  );

  assert.equal(result.status, "succeeded");
  assert.deepEqual(operations, []);
  assert.equal(result.changed, 1);
  assert.deepEqual(
    result.intents.map(({ kind, dryRun }) => ({ kind, dryRun })),
    [
      { kind: "persist_state", dryRun: true },
      { kind: "deliver_transition", dryRun: true },
    ],
  );
});

test("skips detector execution when cadence is not due", async () => {
  let detectorCalls = 0;
  const state: SignalState = {
    accountId: account.id,
    detectorId: "detector:dns",
    state: "confirmed",
    confidence: "high",
    lastCheckedAt: "2026-08-07T11:00:00.000Z",
    lastConclusiveObservationAt: "2026-08-07T11:00:00.000Z",
    evidenceCodes: ["dns_match"],
    version: 1,
  };
  const detector = makeDetector(async () => {
    detectorCalls += 1;
    return makeObservation();
  });

  const result = await runCompetitiveFootprint(context, config, {
    ...makeDependencies(),
    detectors: [detector],
    stateStore: new InMemorySignalStateStore([state]),
  });

  assert.equal(detectorCalls, 0);
  assert.deepEqual(
    pickCounts(result),
    { selected: 1, processed: 0, changed: 0, unchanged: 0, skipped: 1, failed: 0 },
  );
});

test("persistence failure prevents destination delivery", async () => {
  const operations: string[] = [];
  const store: SignalStateStore = {
    async get() {
      return null;
    },
    async record() {
      operations.push("persist");
      throw new FrameworkOperationError("storage unavailable", "transient", true);
    },
  };

  const result = await runCompetitiveFootprint(context, config, {
    ...makeDependencies(),
    stateStore: store,
    destinations: [new RecordingDestination(operations)],
  });

  assert.equal(result.status, "partial_failure");
  assert.deepEqual(operations, ["persist"]);
  assert.equal(result.changed, 0);
  assert.deepEqual(result.failures, [
    {
      category: "transient",
      operation: "persist_state",
      accountId: account.id,
      retryable: true,
      message: "storage unavailable",
    },
  ]);
});

test("detector failure is isolated and categorized", async () => {
  const detector = makeDetector(async () => {
    throw new FrameworkOperationError("probe timeout", "transient", true);
  });

  const result = await runCompetitiveFootprint(context, config, {
    ...makeDependencies(),
    detectors: [detector],
  });

  assert.equal(result.status, "partial_failure");
  assert.equal(result.processed, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.failures[0]?.operation, "detect:detector:dns");
  assert.equal(result.failures[0]?.retryable, true);
});

test("invalid configuration fails before reading accounts", async () => {
  let sourceReads = 0;
  const source: AccountSource = {
    async *listAccounts() {
      sourceReads += 1;
      yield account;
    },
  };

  await assert.rejects(
    () =>
      runCompetitiveFootprint(context, { ...config, detectorIds: [] }, {
        ...makeDependencies(),
        accountSource: source,
      }),
    /at least one detector is required/,
  );
  assert.equal(sourceReads, 0);
});

test("missing configured detector fails before reading accounts", async () => {
  let sourceReads = 0;
  const source: AccountSource = {
    async *listAccounts() {
      sourceReads += 1;
      yield account;
    },
  };

  await assert.rejects(
    () =>
      runCompetitiveFootprint(context, config, {
        ...makeDependencies(),
        accountSource: source,
        detectors: [],
      }),
    /configured detectors are unavailable/,
  );
  assert.equal(sourceReads, 0);
});

function makeDependencies(): CompetitiveFootprintDependencies {
  return {
    accountSource: {
      async *listAccounts() {
        yield account;
      },
    },
    detectors: [makeDetector(async () => makeObservation())],
    stateStore: new InMemorySignalStateStore(),
    destinations: [],
    clock: { now: () => new Date("2026-08-07T12:00:00.000Z") },
    transitionPolicy: () => ({
      lossCriteriaSatisfied: false,
      historicalEvidenceOnly: false,
    }),
  };
}

function makeDetector(observe: SignalDetector["observe"]): SignalDetector {
  return { id: "detector:dns", kind: "dns", observe };
}

function makeObservation(): SignalObservation {
  return {
    accountId: account.id,
    detectorId: "detector:dns",
    detectorKind: "dns",
    observedAt: "2026-08-07T12:00:00.000Z",
    status: "positive",
    confidence: "high",
    evidenceCodes: ["dns_match"],
    fingerprint: "fingerprint:1",
  };
}

class RecordingStore implements SignalStateStore {
  readonly #operations: string[];
  readonly #store = new InMemorySignalStateStore();

  constructor(operations: string[]) {
    this.#operations = operations;
  }

  get(accountId: string, detectorId: string): Promise<SignalState | null> {
    return this.#store.get(accountId, detectorId);
  }

  record(
    observation: SignalObservation,
    next: SignalState,
    transition: SignalTransition | null,
  ): Promise<"created" | "duplicate"> {
    this.#operations.push("persist");
    return this.#store.record(observation, next, transition);
  }
}

class RecordingDestination implements TransitionDestination {
  readonly #operations: string[];

  constructor(operations: string[]) {
    this.#operations = operations;
  }

  async deliver(): Promise<void> {
    this.#operations.push("deliver");
  }
}

function pickCounts(result: Awaited<ReturnType<typeof runCompetitiveFootprint>>) {
  return {
    selected: result.selected,
    processed: result.processed,
    changed: result.changed,
    unchanged: result.unchanged,
    skipped: result.skipped,
    failed: result.failed,
  };
}
