#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import type { AccountSegment, RunResult } from "@growth-frameworks/contracts/competitive-footprint";
import { runCompetitiveFootprint } from "@growth-frameworks/competitive-footprint";
import {
  HubSpotSingleCompanyAccountSource,
  NodeHubSpotCompanyHttpClient,
  RetryingHubSpotCompanyHttpPort,
  type HubSpotCompanyHttpPort,
} from "@growth-frameworks/hubspot";
import {
  DnsSignalDetector,
  NodeDnsResolver,
  NodeHttpProbeClient,
  NodePublicAddressResolver,
  NodeTcpProbeClient,
  SubdomainSignalDetector,
  TcpSignalDetector,
  type DnsResolverPort,
  type HttpProbeClientPort,
  type NodeDnsResolverConfig,
  type TcpProbeClientPort,
} from "@growth-frameworks/probes";

import { loadCompetitiveFootprintConfig } from "./external-input.ts";
import { NoWriteDestination, NoWriteStateStore } from "./no-write-adapters.ts";

const tokenEnvironmentVariable = "HUBSPOT_ACCESS_TOKEN";

export interface HubSpotCanaryOptions {
  readonly configPath: string;
  readonly companyId: string;
  readonly expectedDomain: string;
  readonly segment: AccountSegment;
  readonly at: string;
  readonly dryRun: true;
  readonly allowNetwork: true;
  readonly productionCanary: true;
}

export interface RedactedCanaryResult {
  readonly status: RunResult["status"];
  readonly selected: number;
  readonly processed: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly skipped: number;
  readonly failed: number;
  readonly failureCategories: readonly string[];
  readonly detectors: readonly RedactedDetectorOutcome[];
}

export interface RedactedDetectorOutcome {
  readonly detectorId: string;
  readonly status: "completed" | "failed" | "not_completed";
  readonly category?: string;
  readonly retryable?: boolean;
}

export interface HubSpotCanaryReport {
  readonly command: "competitive-footprint";
  readonly mode: "hubspot-exact-id-production-canary";
  readonly exactCompanyCount: 1;
  readonly stateWriteEnabled: false;
  readonly deliveryEnabled: false;
  readonly result: RedactedCanaryResult;
}

export interface HubSpotCanaryAdapterFactory {
  createHubSpotHttp(): HubSpotCompanyHttpPort;
  createDnsResolver(config: NodeDnsResolverConfig): DnsResolverPort;
  createHttpProbeClient(): HttpProbeClientPort;
  createTcpProbeClient(): TcpProbeClientPort;
}

export async function runHubSpotCanary(
  options: HubSpotCanaryOptions,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  adapters: HubSpotCanaryAdapterFactory = new NodeHubSpotCanaryAdapterFactory(),
): Promise<HubSpotCanaryReport> {
  if (options.dryRun !== true || options.allowNetwork !== true || options.productionCanary !== true) {
    throw new TypeError("HubSpot production canary requires all explicit safety gates");
  }
  const accessToken = environment[tokenEnvironmentVariable];
  if (accessToken === undefined || accessToken.length === 0) throw new TypeError(`HubSpot canary requires ${tokenEnvironmentVariable}`);
  const runAt = new Date(options.at);
  if (Number.isNaN(runAt.getTime())) throw new TypeError("HubSpot canary time must be a valid ISO timestamp");
  const configuration = await loadCompetitiveFootprintConfig(options.configPath);
  const publicAddresses = adapters;
  const detectors = [
    ...configuration.dns.map(({ detector, resolver }) => new DnsSignalDetector(detector, publicAddresses.createDnsResolver(resolver))),
    ...configuration.subdomain.map((detector) => new SubdomainSignalDetector(detector, publicAddresses.createHttpProbeClient())),
    ...configuration.tcp.map((detector) => new TcpSignalDetector(detector, publicAddresses.createTcpProbeClient())),
  ];
  const accountSource = new HubSpotSingleCompanyAccountSource({
    accessToken,
    companyId: options.companyId,
    expectedDomain: options.expectedDomain,
    segment: options.segment,
    http: new RetryingHubSpotCompanyHttpPort({ http: adapters.createHubSpotHttp(), maxAttempts: 2, maximumDelayMs: 5_000 }),
  });
  const startedAt = runAt.toISOString();
  const result = await runCompetitiveFootprint(
    { runId: `hubspot-production-canary:${startedAt}`, startedAt, dryRun: true },
    configuration.framework,
    {
      accountSource,
      detectors,
      stateStore: new NoWriteStateStore(),
      destinations: [new NoWriteDestination()],
      clock: { now: () => runAt },
      transitionPolicy: () => ({ lossCriteriaSatisfied: false, historicalEvidenceOnly: false }),
    },
  );
  return {
    command: "competitive-footprint",
    mode: "hubspot-exact-id-production-canary",
    exactCompanyCount: 1,
    stateWriteEnabled: false,
    deliveryEnabled: false,
    result: redactCanaryResult(result, configuration.framework.detectorIds),
  };
}

export function redactCanaryResult(
  result: RunResult,
  detectorIds: readonly string[],
): RedactedCanaryResult {
  const completed = new Set(result.intents.map(({ detectorId }) => detectorId));
  const failures = new Map(
    result.failures.flatMap((failure) => {
      if (!failure.operation.startsWith("detect:")) return [];
      const detectorId = failure.operation.slice("detect:".length);
      return detectorIds.includes(detectorId) ? [[detectorId, failure] as const] : [];
    }),
  );
  return {
    status: result.status,
    selected: result.selected,
    processed: result.processed,
    changed: result.changed,
    unchanged: result.unchanged,
    skipped: result.skipped,
    failed: result.failed,
    failureCategories: [...new Set(result.failures.map(({ category }) => category))],
    detectors: detectorIds.map((detectorId) => {
      const failure = failures.get(detectorId);
      if (failure !== undefined) {
        return { detectorId, status: "failed", category: failure.category, retryable: failure.retryable };
      }
      return { detectorId, status: completed.has(detectorId) ? "completed" : "not_completed" };
    }),
  };
}

export function parseHubSpotCanaryArgs(args: readonly string[]): HubSpotCanaryOptions {
  const booleanFlags = ["--dry-run", "--allow-network", "--production-canary"] as const;
  const valueFlags = ["--config", "--company-id", "--expected-domain", "--segment", "--at"] as const;
  validateTokens(args, new Set(booleanFlags), new Set(valueFlags));
  for (const flag of booleanFlags) {
    if (args.filter((value) => value === flag).length !== 1) throw new TypeError(`HubSpot production canary requires ${flag} exactly once`);
  }
  const segment = readSingleValue(args, "--segment");
  if (segment !== "high_priority" && segment !== "standard" && segment !== "low_priority") throw new TypeError("--segment is invalid");
  const companyId = readSingleValue(args, "--company-id");
  if (!/^\d{1,32}$/.test(companyId)) throw new TypeError("--company-id must be numeric");
  return {
    configPath: readSingleValue(args, "--config"),
    companyId,
    expectedDomain: readSingleValue(args, "--expected-domain"),
    segment,
    at: readOptionalValue(args, "--at") ?? new Date().toISOString(),
    dryRun: true,
    allowNetwork: true,
    productionCanary: true,
  };
}

export async function main(
  args: readonly string[],
  writeOutput: (value: string) => void = (value) => process.stdout.write(value),
  writeError: (value: string) => void = (value) => process.stderr.write(value),
  execute: (options: HubSpotCanaryOptions) => Promise<HubSpotCanaryReport> = runHubSpotCanary,
): Promise<number> {
  try {
    const report = await execute(parseHubSpotCanaryArgs(args));
    writeOutput(`${JSON.stringify(report, null, 2)}\n`);
    return report.result.status === "succeeded" ? 0 : 1;
  } catch (error) {
    writeError(`${error instanceof Error ? error.message : "HubSpot canary failed"}\n`);
    return 1;
  }
}

class NodeHubSpotCanaryAdapterFactory implements HubSpotCanaryAdapterFactory {
  readonly #publicAddresses = new NodePublicAddressResolver();
  createHubSpotHttp(): HubSpotCompanyHttpPort { return new NodeHubSpotCompanyHttpClient(); }
  createDnsResolver(config: NodeDnsResolverConfig): DnsResolverPort { return new NodeDnsResolver(config); }
  createHttpProbeClient(): HttpProbeClientPort { return new NodeHttpProbeClient(this.#publicAddresses); }
  createTcpProbeClient(): TcpProbeClientPort { return new NodeTcpProbeClient(this.#publicAddresses); }
}

function validateTokens(args: readonly string[], booleanFlags: ReadonlySet<string>, valueFlags: ReadonlySet<string>): void {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (booleanFlags.has(value)) continue;
    if (valueFlags.has(value)) {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--")) throw new TypeError(`${value} requires a value`);
      index += 1;
      continue;
    }
    throw new TypeError(`Unknown argument: ${value}`);
  }
}

function readSingleValue(args: readonly string[], flag: string): string {
  const indexes = args.flatMap((value, index) => (value === flag ? [index] : []));
  if (indexes.length !== 1) throw new TypeError(`${flag} must appear once`);
  return args[indexes[0]! + 1]!;
}

function readOptionalValue(args: readonly string[], flag: string): string | undefined {
  return args.includes(flag) ? readSingleValue(args, flag) : undefined;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) process.exitCode = await main(process.argv.slice(2));
