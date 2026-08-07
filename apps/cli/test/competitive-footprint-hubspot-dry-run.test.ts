import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { HubSpotCompanyHttpPort, HubSpotCompanyHttpRequest } from "@growth-frameworks/hubspot";
import type { DnsResolverPort, HttpProbeClientPort, NodeDnsResolverConfig, TcpProbeClientPort } from "@growth-frameworks/probes";

import {
  main,
  parseHubSpotDryRunArgs,
  runHubSpotDryRun,
  type HubSpotDryRunAdapterFactory,
} from "../src/competitive-footprint-hubspot-dry-run.ts";

const configPath = fileURLToPath(new URL("../../../examples/competitive-footprint/config.json", import.meta.url));
const hubspotConfigPath = fileURLToPath(new URL("../../../examples/competitive-footprint/hubspot-source.json", import.meta.url));
const runAt = "2026-08-07T12:00:00.000Z";

test("composes a HubSpot-backed network dry run without writes or delivery", async () => {
  const adapters = new SyntheticAdapters();
  const report = await runHubSpotDryRun(
    { configPath, hubspotConfigPath, at: runAt, dryRun: true, allowNetwork: true },
    { HUBSPOT_ACCESS_TOKEN: "synthetic-token-do-not-use" },
    adapters,
  );
  assert.equal(report.mode, "hubspot-network-dry-run");
  assert.equal(report.accountCount, 1);
  assert.equal(report.stateWriteEnabled, false);
  assert.equal(report.deliveryEnabled, false);
  assert.deepEqual(
    { selected: report.result.selected, processed: report.result.processed, changed: report.result.changed, failed: report.result.failed },
    { selected: 3, processed: 3, changed: 3, failed: 0 },
  );
  assert.ok(report.result.intents.every(({ dryRun }) => dryRun));
  assert.equal(adapters.hubspotRequests.length, 1);
});

test("requires explicit safety flags, config files, and environment token", async () => {
  assert.throws(() => parseHubSpotDryRunArgs(["--config", configPath, "--hubspot-config", hubspotConfigPath, "--dry-run"]), /allow-network/);
  assert.throws(() => parseHubSpotDryRunArgs(["--config", configPath, "--hubspot-config", hubspotConfigPath, "--allow-network"]), /dry-run/);
  await assert.rejects(
    () => runHubSpotDryRun(
      { configPath, hubspotConfigPath, at: runAt, dryRun: true, allowNetwork: true },
      {},
      new SyntheticAdapters(),
    ),
    /HUBSPOT_ACCESS_TOKEN/,
  );
});

test("CLI refuses execution before authorization and never accepts a token argument", async () => {
  let executed = false;
  let error = "";
  const exitCode = await main(
    ["--config", configPath, "--hubspot-config", hubspotConfigPath, "--dry-run"],
    () => {},
    (value) => { error += value; },
    async () => { executed = true; throw new Error("must not execute"); },
  );
  assert.equal(exitCode, 1);
  assert.equal(executed, false);
  assert.match(error, /allow-network/);
  assert.throws(
    () => parseHubSpotDryRunArgs(["--config", configPath, "--hubspot-config", hubspotConfigPath, "--dry-run", "--allow-network", "--token", "secret"]),
    /Unknown argument: --token/,
  );
});

class SyntheticAdapters implements HubSpotDryRunAdapterFactory {
  readonly hubspotRequests: HubSpotCompanyHttpRequest[] = [];
  createHubSpotHttp(): HubSpotCompanyHttpPort {
    return { request: async (input) => {
      this.hubspotRequests.push(input);
      return { status: 200, body: { results: [{ id: "100001", properties: { name: "Synthetic", domain: "example.com", monitoring_tier: "tier_2" }, archived: false }] } };
    } };
  }
  createDnsResolver(_config: NodeDnsResolverConfig): DnsResolverPort {
    return { resolve: async () => ({ status: "answered", values: ["edge.vendor.example"] }) };
  }
  createHttpProbeClient(): HttpProbeClientPort {
    return { probe: async () => ({ status: "responded", statusCode: 200, redirects: 0, truncated: false }) };
  }
  createTcpProbeClient(): TcpProbeClientPort {
    return { probe: async () => ({ status: "connected", family: 4 }) };
  }
}
