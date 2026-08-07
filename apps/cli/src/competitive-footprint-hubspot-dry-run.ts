#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import type { Account, AccountSource, RunContext, RunResult } from "@growth-frameworks/contracts/competitive-footprint";
import { runCompetitiveFootprint } from "@growth-frameworks/competitive-footprint";
import {
  HubSpotCompanyAccountSource,
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
import { loadHubSpotSourceConfig } from "./hubspot-input.ts";
import { NoWriteDestination, NoWriteStateStore } from "./no-write-adapters.ts";

const tokenEnvironmentVariable = "HUBSPOT_ACCESS_TOKEN";

export interface HubSpotDryRunOptions {
  readonly configPath: string;
  readonly hubspotConfigPath: string;
  readonly at: string;
  readonly dryRun: true;
  readonly allowNetwork: true;
}

export interface HubSpotDryRunReport {
  readonly command: "competitive-footprint";
  readonly mode: "hubspot-network-dry-run";
  readonly networkAuthorized: true;
  readonly stateWriteEnabled: false;
  readonly deliveryEnabled: false;
  readonly accountCount: number;
  readonly result: RunResult;
}

export interface HubSpotDryRunAdapterFactory {
  createHubSpotHttp(): HubSpotCompanyHttpPort;
  createDnsResolver(config: NodeDnsResolverConfig): DnsResolverPort;
  createHttpProbeClient(): HttpProbeClientPort;
  createTcpProbeClient(): TcpProbeClientPort;
}

export async function runHubSpotDryRun(
  options: HubSpotDryRunOptions,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  adapters: HubSpotDryRunAdapterFactory = new NodeHubSpotDryRunAdapterFactory(),
): Promise<HubSpotDryRunReport> {
  if (options.dryRun !== true) throw new TypeError("HubSpot scan requires dry-run mode");
  if (options.allowNetwork !== true) throw new TypeError("HubSpot scan requires explicit network authorization");
  const accessToken = environment[tokenEnvironmentVariable];
  if (accessToken === undefined || accessToken.length === 0) {
    throw new TypeError(`HubSpot scan requires ${tokenEnvironmentVariable}`);
  }
  const runAt = new Date(options.at);
  if (Number.isNaN(runAt.getTime())) throw new TypeError("HubSpot dry-run time must be a valid ISO timestamp");

  const [configuration, hubspot] = await Promise.all([
    loadCompetitiveFootprintConfig(options.configPath),
    loadHubSpotSourceConfig(options.hubspotConfigPath),
  ]);
  const detectors = [
    ...configuration.dns.map(
      ({ detector, resolver }) => new DnsSignalDetector(detector, adapters.createDnsResolver(resolver)),
    ),
    ...configuration.subdomain.map(
      (detector) => new SubdomainSignalDetector(detector, adapters.createHttpProbeClient()),
    ),
    ...configuration.tcp.map(
      (detector) => new TcpSignalDetector(detector, adapters.createTcpProbeClient()),
    ),
  ];
  const retryingHttp = new RetryingHubSpotCompanyHttpPort({
    http: adapters.createHubSpotHttp(),
    ...hubspot.retry,
  });
  const accountSource = new CountingAccountSource(
    new HubSpotCompanyAccountSource({
      accessToken,
      mapping: hubspot.mapping,
      http: retryingHttp,
      ...hubspot.request,
    }),
  );
  const startedAt = runAt.toISOString();
  const result = await runCompetitiveFootprint(
    { runId: `hubspot-network-dry-run:${startedAt}`, startedAt, dryRun: true },
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
    mode: "hubspot-network-dry-run",
    networkAuthorized: true,
    stateWriteEnabled: false,
    deliveryEnabled: false,
    accountCount: accountSource.count,
    result,
  };
}

export function parseHubSpotDryRunArgs(args: readonly string[]): HubSpotDryRunOptions {
  validateTokens(args);
  for (const flag of ["--dry-run", "--allow-network"] as const) {
    if (args.filter((value) => value === flag).length !== 1) throw new TypeError(`HubSpot scan requires ${flag} exactly once`);
  }
  return {
    configPath: readSingleValue(args, "--config"),
    hubspotConfigPath: readSingleValue(args, "--hubspot-config"),
    at: readOptionalValue(args, "--at") ?? new Date().toISOString(),
    dryRun: true,
    allowNetwork: true,
  };
}

export async function main(
  args: readonly string[],
  writeOutput: (value: string) => void = (value) => process.stdout.write(value),
  writeError: (value: string) => void = (value) => process.stderr.write(value),
  execute: (options: HubSpotDryRunOptions) => Promise<HubSpotDryRunReport> = runHubSpotDryRun,
): Promise<number> {
  if (args.includes("--help")) {
    writeOutput("Usage: npm run scan:competitive-footprint:hubspot -- --config FILE --hubspot-config FILE --dry-run --allow-network [--at ISO_TIMESTAMP]\n");
    return 0;
  }
  try {
    const report = await execute(parseHubSpotDryRunArgs(args));
    writeOutput(`${JSON.stringify(report, null, 2)}\n`);
    return report.result.status === "succeeded" ? 0 : 1;
  } catch (error) {
    writeError(`${error instanceof Error ? error.message : "HubSpot dry run failed"}\n`);
    return 1;
  }
}

class NodeHubSpotDryRunAdapterFactory implements HubSpotDryRunAdapterFactory {
  readonly #publicAddresses = new NodePublicAddressResolver();
  createHubSpotHttp(): HubSpotCompanyHttpPort { return new NodeHubSpotCompanyHttpClient(); }
  createDnsResolver(config: NodeDnsResolverConfig): DnsResolverPort { return new NodeDnsResolver(config); }
  createHttpProbeClient(): HttpProbeClientPort { return new NodeHttpProbeClient(this.#publicAddresses); }
  createTcpProbeClient(): TcpProbeClientPort { return new NodeTcpProbeClient(this.#publicAddresses); }
}

class CountingAccountSource implements AccountSource {
  count = 0;
  readonly #source: AccountSource;
  constructor(source: AccountSource) { this.#source = source; }
  async *listAccounts(context: RunContext): AsyncIterable<Account> {
    for await (const account of this.#source.listAccounts(context)) {
      this.count += 1;
      yield account;
    }
  }
}

function validateTokens(args: readonly string[]): void {
  const booleanFlags = new Set(["--dry-run", "--allow-network"]);
  const valueFlags = new Set(["--config", "--hubspot-config", "--at"]);
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
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  process.exitCode = await main(process.argv.slice(2));
}
