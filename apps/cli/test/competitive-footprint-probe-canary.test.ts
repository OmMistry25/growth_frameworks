import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { DnsResolverPort, HttpProbeClientPort, NodeDnsResolverConfig, TcpProbeClientPort } from "@growth-frameworks/probes";
import {
  parseProbeCanaryArgs,
  runProbeCanary,
  type ProbeCanaryAdapterFactory,
} from "../src/competitive-footprint-probe-canary.ts";

const configPath = fileURLToPath(new URL("../../../examples/competitive-footprint/config.json", import.meta.url));

test("runs one exact-domain probe canary without CRM, state, or delivery", async () => {
  const report = await runProbeCanary(
    {
      configPath,
      expectedDomain: "console.com",
      segment: "standard",
      at: "2026-08-07T12:00:00.000Z",
      dryRun: true,
      allowNetwork: true,
      probeOnlyCanary: true,
    },
    new SyntheticAdapters(),
  );
  assert.equal(report.crmAccessEnabled, false);
  assert.equal(report.stateWriteEnabled, false);
  assert.equal(report.deliveryEnabled, false);
  assert.equal(report.exactDomainCount, 1);
  assert.equal(report.result.processed, 3);
  assert.ok(report.result.detectors.every(({ status }) => status === "completed"));
  assert.doesNotMatch(JSON.stringify(report), /console\.com/);
});

test("requires all gates and rejects CRM or token arguments", () => {
  const required = [
    "--config", configPath,
    "--expected-domain", "console.com",
    "--segment", "standard",
    "--dry-run",
    "--allow-network",
    "--probe-only-canary",
  ];
  assert.equal(parseProbeCanaryArgs(required).expectedDomain, "console.com");
  assert.throws(() => parseProbeCanaryArgs(required.filter((value) => value !== "--probe-only-canary")), /probe-only-canary/);
  assert.throws(() => parseProbeCanaryArgs([...required, "--company-id", "123"]), /Unknown argument: --company-id/);
  assert.throws(() => parseProbeCanaryArgs([...required, "--token", "secret"]), /Unknown argument: --token/);
});

class SyntheticAdapters implements ProbeCanaryAdapterFactory {
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
