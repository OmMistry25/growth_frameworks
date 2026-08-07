import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { HubSpotCompanyHttpPort } from "@growth-frameworks/hubspot";
import type { DnsResolverPort, HttpProbeClientPort, NodeDnsResolverConfig, TcpProbeClientPort } from "@growth-frameworks/probes";
import {
  parseHubSpotCanaryArgs,
  runHubSpotCanary,
  type HubSpotCanaryAdapterFactory,
} from "../src/competitive-footprint-hubspot-canary.ts";
import { redactCanaryResult } from "../src/redacted-canary-result.ts";

const configPath = fileURLToPath(new URL("../../../examples/competitive-footprint/config.json", import.meta.url));
const companyId = "336132462329";
const token = "synthetic-token-do-not-use";

test("runs one exact-ID canary and returns only redacted aggregates", async () => {
  const report = await runHubSpotCanary(
    {
      configPath,
      companyId,
      expectedDomain: "console.com",
      segment: "standard",
      at: "2026-08-07T12:00:00.000Z",
      dryRun: true,
      allowNetwork: true,
      productionCanary: true,
    },
    { HUBSPOT_ACCESS_TOKEN: token },
    new SyntheticAdapters(),
  );
  assert.equal(report.exactCompanyCount, 1);
  assert.deepEqual(
    { selected: report.result.selected, processed: report.result.processed, changed: report.result.changed },
    { selected: 3, processed: 3, changed: 3 },
  );
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, new RegExp(companyId));
  assert.doesNotMatch(serialized, /console\.com/);
  assert.doesNotMatch(serialized, new RegExp(token));
  assert.deepEqual(report.result.detectors, [
    { detectorId: "detector:example-dns", status: "completed" },
    { detectorId: "detector:example-subdomain", status: "completed" },
    { detectorId: "detector:example-tcp", status: "completed" },
  ]);
});

test("reports safe per-detector failure metadata without messages or account identity", () => {
  const result = redactCanaryResult(
    {
      runId: "secret-run-id",
      status: "partial_failure",
      selected: 3,
      processed: 1,
      changed: 0,
      unchanged: 1,
      skipped: 0,
      failed: 2,
      failures: [
        { category: "transient", operation: "detect:detector:example-subdomain", accountId: `hubspot:company:${companyId}`, failureCode: "hostname_resolution_failed", retryable: true, message: "private endpoint detail" },
        { category: "transient", operation: "detect:detector:example-tcp", accountId: `hubspot:company:${companyId}`, failureCode: "tcp_connection_failed", retryable: true, message: "private socket detail" },
      ],
      intents: [
        { kind: "persist_state", idempotencyKey: "private-key", accountId: `hubspot:company:${companyId}`, detectorId: "detector:example-dns", dryRun: true },
      ],
    },
    ["detector:example-dns", "detector:example-subdomain", "detector:example-tcp"],
  );
  assert.deepEqual(result.detectors, [
    { detectorId: "detector:example-dns", status: "completed" },
    { detectorId: "detector:example-subdomain", status: "failed", category: "transient", code: "hostname_resolution_failed", retryable: true },
    { detectorId: "detector:example-tcp", status: "failed", category: "transient", code: "tcp_connection_failed", retryable: true },
  ]);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /private|secret-run-id/);
  assert.doesNotMatch(serialized, new RegExp(companyId));
});

test("requires all explicit gates and rejects broad or secret arguments", () => {
  const required = [
    "--config", configPath,
    "--company-id", companyId,
    "--expected-domain", "console.com",
    "--segment", "standard",
    "--dry-run",
    "--allow-network",
    "--production-canary",
  ];
  assert.equal(parseHubSpotCanaryArgs(required).companyId, companyId);
  assert.throws(() => parseHubSpotCanaryArgs(required.filter((value) => value !== "--production-canary")), /production-canary/);
  assert.throws(() => parseHubSpotCanaryArgs([...required, "--token", "secret"]), /Unknown argument: --token/);
  assert.throws(() => parseHubSpotCanaryArgs(required.map((value) => value === companyId ? "all" : value)), /must be numeric/);
});

class SyntheticAdapters implements HubSpotCanaryAdapterFactory {
  createHubSpotHttp(): HubSpotCompanyHttpPort {
    return { request: async () => ({ status: 200, body: { id: companyId, properties: { name: "Authorized", domain: "console.com" }, archived: false } }) };
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
