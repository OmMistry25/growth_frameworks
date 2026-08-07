import assert from "node:assert/strict";
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
  runNetworkDryRun,
  type ProbeAdapterFactory,
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
