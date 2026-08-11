import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type {
  DnsResolverPort,
  HttpProbeClientPort,
  NodeDnsResolverConfig,
  TcpProbeClientPort,
} from "@growth-frameworks/probes";

import {
  main,
  parseNetworkDryRunArgs,
  parseNetworkScanArgs,
  runNetworkDryRun,
  runNetworkScan,
  type ProbeAdapterFactory,
  type RunRecordStoreFactory,
} from "../src/competitive-footprint-network-dry-run.ts";

const configPath = fileURLToPath(
  new URL("../../../examples/competitive-footprint/config.json", import.meta.url),
);
const accountsPath = fileURLToPath(
  new URL("../../../examples/competitive-footprint/accounts.json", import.meta.url),
);
const runAt = "2026-08-07T12:00:00.000Z";

test("network-authorized dry run composes real connector boundaries without writes", async () => {
  const report = await runNetworkDryRun(
    {
      configPath,
      accountsPath,
      at: runAt,
      dryRun: true,
      allowNetwork: true,
    },
    new SyntheticProbeAdapterFactory(),
  );

  assert.equal(report.mode, "network-dry-run");
  assert.equal(report.networkAuthorized, true);
  assert.equal(report.accountCount, 1);
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
});

test("argument parser requires both safety gates and input files", () => {
  assert.throws(
    () => parseNetworkDryRunArgs(["--config", configPath, "--accounts", accountsPath, "--dry-run"]),
    /requires --allow-network/,
  );
  assert.throws(
    () => parseNetworkDryRunArgs(["--config", configPath, "--accounts", accountsPath, "--allow-network"]),
    /requires --dry-run/,
  );
  assert.throws(
    () => parseNetworkDryRunArgs(["--dry-run", "--allow-network", "--config", configPath]),
    /--accounts must appear once/,
  );
});

test("argument parser rejects duplicates and positional input", () => {
  assert.throws(
    () =>
      parseNetworkDryRunArgs([
        "--dry-run",
        "--dry-run",
        "--allow-network",
        "--config",
        configPath,
        "--accounts",
        accountsPath,
      ]),
    /--dry-run must appear once/,
  );
  assert.throws(
    () =>
      parseNetworkDryRunArgs([
        "--dry-run",
        "--allow-network",
        "--config",
        configPath,
        "--accounts",
        accountsPath,
        "unexpected",
      ]),
    /Unknown argument: unexpected/,
  );
});

test("stateful mode requires write authorization, state, and run-record paths", () => {
  assert.throws(
    () => parseNetworkScanArgs(["--allow-network", "--config", configPath, "--accounts", accountsPath]),
    /requires --allow-state-write/,
  );
  assert.throws(
    () =>
      parseNetworkScanArgs([
        "--allow-network",
        "--allow-state-write",
        "--config",
        configPath,
        "--accounts",
        accountsPath,
      ]),
    /--state-file must appear once/,
  );
  assert.throws(
    () =>
      parseNetworkScanArgs([
        "--allow-network",
        "--allow-state-write",
        "--state-file",
        "state.json",
        "--config",
        configPath,
        "--accounts",
        accountsPath,
      ]),
    /--run-record-dir must appear once/,
  );
  assert.throws(
    () =>
      parseNetworkScanArgs([
        "--allow-network",
        "--dry-run",
        "--allow-state-write",
        "--state-file",
        "state.json",
        "--run-record-dir",
        "run-records",
        "--config",
        configPath,
        "--accounts",
        accountsPath,
      ]),
    /cannot authorize state writes/,
  );
});

test("stateful scan persists results and keeps delivery disabled", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "growth-frameworks-cli-state-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const statePath = join(directory, "state.json");
  const runRecordDirectory = join(directory, "run-records");
  const options = {
    configPath,
    accountsPath,
    at: runAt,
    dryRun: false,
    allowNetwork: true,
    allowStateWrite: true,
    statePath,
    runRecordDirectory,
  } as const;
  const first = await runNetworkScan(options, new SyntheticProbeAdapterFactory());
  assert.equal(first.mode, "network-stateful");
  if (first.mode !== "network-stateful") throw new Error("Expected a stateful scan report");
  assert.equal(first.deliveryEnabled, false);
  assert.equal(first.runRecord, "created");
  assert.equal(first.result.status, "succeeded");
  assert.deepEqual(
    { selected: first.result.selected, processed: first.result.processed, changed: first.result.changed },
    { selected: 3, processed: 3, changed: 3 },
  );
  assert.ok(first.result.intents.every(({ dryRun }) => !dryRun));

  const repeated = await runNetworkScan(
    { ...options, at: "2026-08-07T12:00:01.000Z" },
    new SyntheticProbeAdapterFactory(),
  );
  if (repeated.mode !== "network-stateful") throw new Error("Expected a stateful scan report");
  assert.equal(repeated.runRecord, "created");
  assert.deepEqual(
    {
      selected: repeated.result.selected,
      processed: repeated.result.processed,
      skipped: repeated.result.skipped,
    },
    { selected: 3, processed: 0, skipped: 3 },
  );
});

test("stateful scan writes only aggregate secret-safe run fields", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "growth-frameworks-cli-run-record-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const records: unknown[] = [];
  const factory: RunRecordStoreFactory = {
    create() {
      return {
        async record(value) {
          records.push(value);
          return "created";
        },
      };
    },
  };
  await runNetworkScan(
    {
      configPath,
      accountsPath,
      at: runAt,
      dryRun: false,
      allowNetwork: true,
      allowStateWrite: true,
      statePath: join(directory, "state.json"),
      runRecordDirectory: join(directory, "records"),
    },
    new SyntheticProbeAdapterFactory(),
    undefined,
    factory,
  );
  assert.equal(records.length, 1);
  const serialized = JSON.stringify(records[0]);
  assert.doesNotMatch(serialized, /account:|example\.com|detector:|message|failureCode|intent/i);
});

test("CLI refuses network execution before invoking its runner", async () => {
  let executed = false;
  let error = "";
  const exitCode = await main(
    ["--config", configPath, "--accounts", accountsPath, "--dry-run"],
    () => undefined,
    (value) => {
      error += value;
    },
    async () => {
      executed = true;
      throw new Error("runner must not execute");
    },
  );

  assert.equal(exitCode, 1);
  assert.equal(executed, false);
  assert.equal(error, "Network scanning requires --allow-network\n");
});

class SyntheticProbeAdapterFactory implements ProbeAdapterFactory {
  createDnsResolver(_config: NodeDnsResolverConfig): DnsResolverPort {
    return {
      async resolve() {
        return { status: "answered", values: ["edge.vendor.example"] };
      },
    };
  }

  createHttpClient(): HttpProbeClientPort {
    return {
      async probe() {
        return { status: "responded", statusCode: 200, redirects: 0, truncated: false };
      },
    };
  }

  createTcpClient(): TcpProbeClientPort {
    return {
      async probe() {
        return { status: "connected", family: 4 };
      },
    };
  }
}
