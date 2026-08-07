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

import {
  loadAccountFile,
  loadCompetitiveFootprintConfig,
} from "./external-input.ts";
import { NoWriteDestination, NoWriteStateStore } from "./no-write-adapters.ts";

export interface NetworkDryRunOptions {
  readonly configPath: string;
  readonly accountsPath: string;
  readonly at: string;
  readonly dryRun: true;
  readonly allowNetwork: true;
}

export interface NetworkDryRunReport {
  readonly command: "competitive-footprint";
  readonly mode: "network-dry-run";
  readonly networkAuthorized: true;
  readonly accountCount: number;
  readonly result: RunResult;
}

export interface ProbeAdapterFactory {
  createDnsResolver(config: NodeDnsResolverConfig): DnsResolverPort;
  createHttpClient(): HttpProbeClientPort;
  createTcpClient(): TcpProbeClientPort;
}

export async function runNetworkDryRun(
  options: NetworkDryRunOptions,
  adapters: ProbeAdapterFactory = new NodeProbeAdapterFactory(),
): Promise<NetworkDryRunReport> {
  if (options.dryRun !== true) throw new TypeError("Network scanning requires dry-run mode");
  if (options.allowNetwork !== true) throw new TypeError("Network scanning requires explicit network authorization");
  const runAt = new Date(options.at);
  if (Number.isNaN(runAt.getTime())) throw new TypeError("Network dry-run time must be a valid ISO timestamp");
  const [configuration, accountFile] = await Promise.all([
    loadCompetitiveFootprintConfig(options.configPath),
    loadAccountFile(options.accountsPath),
  ]);
  const detectors = [
    ...configuration.dns.map(
      ({ detector, resolver }) => new DnsSignalDetector(detector, adapters.createDnsResolver(resolver)),
    ),
    ...configuration.subdomain.map(
      (detector) => new SubdomainSignalDetector(detector, adapters.createHttpClient()),
    ),
    ...configuration.tcp.map(
      (detector) => new TcpSignalDetector(detector, adapters.createTcpClient()),
    ),
  ];
  const startedAt = runAt.toISOString();
  const result = await runCompetitiveFootprint(
    { runId: `network-dry-run:${startedAt}`, startedAt, dryRun: true },
    configuration.framework,
    {
      accountSource: new ArrayAccountSource(accountFile.accounts),
      detectors,
      stateStore: new NoWriteStateStore(),
      destinations: [new NoWriteDestination()],
      clock: { now: () => runAt },
      transitionPolicy: () => ({ lossCriteriaSatisfied: false, historicalEvidenceOnly: false }),
    },
  );

  return {
    command: "competitive-footprint",
    mode: "network-dry-run",
    networkAuthorized: true,
    accountCount: accountFile.accounts.length,
    result,
  };
}

export function parseNetworkDryRunArgs(args: readonly string[]): NetworkDryRunOptions {
  validateArgumentTokens(args);
  if (!args.includes("--dry-run")) throw new TypeError("Network scanning requires --dry-run");
  if (!args.includes("--allow-network")) throw new TypeError("Network scanning requires --allow-network");
  assertSingleFlag(args, "--dry-run");
  assertSingleFlag(args, "--allow-network");
  return {
    configPath: readSingleValue(args, "--config"),
    accountsPath: readSingleValue(args, "--accounts"),
    at: readOptionalValue(args, "--at") ?? new Date().toISOString(),
    dryRun: true,
    allowNetwork: true,
  };
}

export async function main(
  args: readonly string[],
  writeOutput: (value: string) => void = (value) => process.stdout.write(value),
  writeError: (value: string) => void = (value) => process.stderr.write(value),
  execute: (options: NetworkDryRunOptions) => Promise<NetworkDryRunReport> = runNetworkDryRun,
): Promise<number> {
  if (args.includes("--help")) {
    writeOutput(
      "Usage: npm run scan:competitive-footprint -- --config FILE --accounts FILE --dry-run --allow-network [--at ISO_TIMESTAMP]\n",
    );
    return 0;
  }
  try {
    const report = await execute(parseNetworkDryRunArgs(args));
    writeOutput(`${JSON.stringify(report, null, 2)}\n`);
    return report.result.status === "succeeded" ? 0 : 1;
  } catch (error) {
    writeError(`${error instanceof Error ? error.message : "Network dry run failed"}\n`);
    return 1;
  }
}

class NodeProbeAdapterFactory implements ProbeAdapterFactory {
  readonly #publicAddresses = new NodePublicAddressResolver();

  createDnsResolver(config: NodeDnsResolverConfig): DnsResolverPort {
    return new NodeDnsResolver(config);
  }

  createHttpClient(): HttpProbeClientPort {
    return new NodeHttpProbeClient(this.#publicAddresses);
  }

  createTcpClient(): TcpProbeClientPort {
    return new NodeTcpProbeClient(this.#publicAddresses);
  }
}

class ArrayAccountSource implements AccountSource {
  readonly #accounts: readonly Account[];

  constructor(accounts: readonly Account[]) {
    this.#accounts = accounts;
  }

  async *listAccounts() {
    yield* this.#accounts;
  }
}

function assertSingleFlag(args: readonly string[], flag: string): void {
  if (args.filter((value) => value === flag).length !== 1) throw new TypeError(`${flag} must appear once`);
}

function validateArgumentTokens(args: readonly string[]): void {
  const booleanFlags = new Set(["--dry-run", "--allow-network"]);
  const valueFlags = new Set(["--config", "--accounts", "--at"]);
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
  const value = args[indexes[0]! + 1];
  if (value === undefined || value.startsWith("--")) throw new TypeError(`${flag} requires a value`);
  return value;
}

function readOptionalValue(args: readonly string[], flag: string): string | undefined {
  if (!args.includes(flag)) return undefined;
  return readSingleValue(args, flag);
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  process.exitCode = await main(process.argv.slice(2));
}
