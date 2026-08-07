#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import type {
  Account,
  AccountSource,
  RunResult,
} from "@growth-frameworks/contracts/competitive-footprint";
import { runCompetitiveFootprint } from "@growth-frameworks/competitive-footprint";
import {
  DnsSignalDetector,
  SubdomainSignalDetector,
  TcpSignalDetector,
  type DnsResolverPort,
  type HttpProbeClientPort,
  type TcpProbeClientPort,
} from "@growth-frameworks/probes";

import { NoWriteDestination, NoWriteStateStore } from "./no-write-adapters.ts";

const syntheticAccount: Account = {
  id: "account:synthetic-example",
  displayName: "Synthetic Example",
  domain: "example.com",
  segment: "standard",
};

export interface DryRunReport {
  readonly command: "competitive-footprint";
  readonly mode: "dry-run";
  readonly fixture: "synthetic";
  readonly result: RunResult;
}

export async function runSyntheticCompetitiveFootprintDryRun(at: string): Promise<DryRunReport> {
  const runAt = new Date(at);
  if (Number.isNaN(runAt.getTime())) throw new TypeError("Dry-run time must be a valid ISO timestamp");
  const startedAt = runAt.toISOString();
  const detectors = createSyntheticDetectors();
  const result = await runCompetitiveFootprint(
    { runId: `dry-run:${startedAt}`, startedAt, dryRun: true },
    {
      detectorIds: detectors.map(({ id }) => id),
      cadence: [{ segment: "standard", state: "unknown", intervalHours: 24 }],
      lossConfirmationCount: 2,
    },
    {
      accountSource: new SyntheticAccountSource(),
      detectors,
      stateStore: new NoWriteStateStore(),
      destinations: [new NoWriteDestination()],
      clock: { now: () => runAt },
      transitionPolicy: () => ({ lossCriteriaSatisfied: false, historicalEvidenceOnly: false }),
    },
  );

  return { command: "competitive-footprint", mode: "dry-run", fixture: "synthetic", result };
}

export async function main(
  args: readonly string[],
  writeOutput: (value: string) => void = (value) => process.stdout.write(value),
  writeError: (value: string) => void = (value) => process.stderr.write(value),
): Promise<number> {
  if (args.includes("--help")) {
    writeOutput("Usage: npm run dry-run:competitive-footprint -- [--at ISO_TIMESTAMP]\n");
    return 0;
  }

  try {
    const report = await runSyntheticCompetitiveFootprintDryRun(readAtArgument(args));
    writeOutput(`${JSON.stringify(report, null, 2)}\n`);
    return report.result.status === "succeeded" ? 0 : 1;
  } catch (error) {
    writeError(`${error instanceof Error ? error.message : "Dry run failed"}\n`);
    return 1;
  }
}

function createSyntheticDetectors() {
  const dnsResolver: DnsResolverPort = {
    async resolve() {
      return { status: "answered", values: ["edge.vendor.example"] };
    },
  };
  const httpClient: HttpProbeClientPort = {
    async probe() {
      return { status: "responded", statusCode: 200, redirects: 0, truncated: false };
    },
  };
  const tcpClient: TcpProbeClientPort = {
    async probe() {
      return { status: "connected", family: 4 };
    },
  };

  return [
    new DnsSignalDetector(
      {
        id: "detector:synthetic-dns",
        rules: [
          {
            hostnameTemplate: "{domain}",
            recordType: "CNAME",
            matcher: { type: "suffix", value: "vendor.example" },
            evidenceCode: "dns_vendor_cname",
            confidence: "high",
          },
        ],
        negativeEvidenceCode: "dns_no_match",
        timeoutEvidenceCode: "dns_timeout",
        negativeConfidence: "medium",
      },
      dnsResolver,
    ),
    new SubdomainSignalDetector(
      {
        id: "detector:synthetic-subdomain",
        rules: [
          {
            hostnameTemplate: "portal.{domain}",
            protocol: "https",
            path: "/health",
            acceptedStatusCodes: [200],
            evidenceCode: "subdomain_responsive",
            confidence: "high",
          },
        ],
        timeoutMs: 2_000,
        maxRedirects: 2,
        maxResponseBytes: 1_024,
        negativeEvidenceCode: "subdomain_unresponsive",
        timeoutEvidenceCode: "subdomain_timeout",
        negativeConfidence: "medium",
      },
      httpClient,
    ),
    new TcpSignalDetector(
      {
        id: "detector:synthetic-tcp",
        rules: [
          {
            hostnameTemplate: "service.{domain}",
            port: 443,
            tls: true,
            evidenceCode: "tcp_service_connected",
            confidence: "high",
          },
        ],
        timeoutMs: 2_000,
        negativeEvidenceCode: "tcp_service_unavailable",
        timeoutEvidenceCode: "tcp_timeout",
        negativeConfidence: "medium",
      },
      tcpClient,
    ),
  ] as const;
}

function readAtArgument(args: readonly string[]): string {
  const index = args.indexOf("--at");
  if (index === -1) {
    if (args.length > 0) throw new TypeError("Unknown dry-run argument");
    return new Date().toISOString();
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new TypeError("--at requires an ISO timestamp");
  if (args.length !== index + 2) throw new TypeError("Unknown dry-run argument");
  return value;
}

class SyntheticAccountSource implements AccountSource {
  async *listAccounts() {
    yield syntheticAccount;
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  process.exitCode = await main(process.argv.slice(2));
}
