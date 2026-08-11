#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import type {
  Account,
  AccountSource,
  ErrorCategory,
  RunRecord,
  RunRecordStore,
  RunResult,
  SignalStateStore,
} from "@growth-frameworks/contracts/competitive-footprint";
import { runCompetitiveFootprint } from "@growth-frameworks/competitive-footprint";
import { FileRunRecordStore, FileSignalStateStore } from "@growth-frameworks/file-state-store";
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

export interface NetworkStatefulScanOptions {
  readonly configPath: string;
  readonly accountsPath: string;
  readonly at: string;
  readonly dryRun: false;
  readonly allowNetwork: true;
  readonly allowStateWrite: true;
  readonly statePath: string;
  readonly runRecordDirectory: string;
}

export type NetworkScanOptions = NetworkDryRunOptions | NetworkStatefulScanOptions;

export interface NetworkDryRunReport {
  readonly command: "competitive-footprint";
  readonly mode: "network-dry-run";
  readonly networkAuthorized: true;
  readonly accountCount: number;
  readonly result: RunResult;
}

export interface NetworkStatefulScanReport {
  readonly command: "competitive-footprint";
  readonly mode: "network-stateful";
  readonly networkAuthorized: true;
  readonly stateWriteAuthorized: true;
  readonly deliveryEnabled: false;
  readonly accountCount: number;
  readonly runRecord: "created" | "duplicate";
  readonly result: RunResult;
}

export type NetworkScanReport = NetworkDryRunReport | NetworkStatefulScanReport;

export interface ProbeAdapterFactory {
  createDnsResolver(config: NodeDnsResolverConfig): DnsResolverPort;
  createHttpClient(): HttpProbeClientPort;
  createTcpClient(): TcpProbeClientPort;
}

export interface StateStoreFactory {
  create(path: string): SignalStateStore;
}

export interface RunRecordStoreFactory {
  create(directory: string): RunRecordStore;
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

export async function runNetworkScan(
  options: NetworkScanOptions,
  adapters: ProbeAdapterFactory = new NodeProbeAdapterFactory(),
  stateStores: StateStoreFactory = new AuthorizedFileStateStoreFactory(),
  runRecords: RunRecordStoreFactory = new AuthorizedFileRunRecordStoreFactory(),
): Promise<NetworkScanReport> {
  if (options.dryRun) return runNetworkDryRun(options, adapters);
  if (options.allowNetwork !== true) throw new TypeError("Network scanning requires explicit network authorization");
  if (options.allowStateWrite !== true) throw new TypeError("State writes require explicit authorization");
  const runAt = new Date(options.at);
  if (Number.isNaN(runAt.getTime())) throw new TypeError("Network scan time must be a valid ISO timestamp");
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
    { runId: `network-stateful:${startedAt}`, startedAt, dryRun: false },
    configuration.framework,
    {
      accountSource: new ArrayAccountSource(accountFile.accounts),
      detectors,
      stateStore: stateStores.create(options.statePath),
      destinations: [],
      clock: { now: () => runAt },
      transitionPolicy: () => ({ lossCriteriaSatisfied: false, historicalEvidenceOnly: false }),
    },
  );
  const runRecord = await runRecords.create(options.runRecordDirectory).record(toRunRecord(startedAt, result));
  return {
    command: "competitive-footprint",
    mode: "network-stateful",
    networkAuthorized: true,
    stateWriteAuthorized: true,
    deliveryEnabled: false,
    accountCount: accountFile.accounts.length,
    runRecord,
    result,
  };
}

export function parseNetworkDryRunArgs(args: readonly string[]): NetworkDryRunOptions {
  if (!args.includes("--dry-run")) throw new TypeError("Network scanning requires --dry-run");
  const options = parseNetworkScanArgs(args);
  if (!options.dryRun) throw new TypeError("Network dry run requires --dry-run");
  return options;
}

export function parseNetworkScanArgs(args: readonly string[]): NetworkScanOptions {
  validateArgumentTokens(args);
  if (!args.includes("--allow-network")) throw new TypeError("Network scanning requires --allow-network");
  assertSingleFlag(args, "--allow-network");
  const common = {
    configPath: readSingleValue(args, "--config"),
    accountsPath: readSingleValue(args, "--accounts"),
    at: readOptionalValue(args, "--at") ?? new Date().toISOString(),
  } as const;
  if (args.includes("--dry-run")) {
    assertSingleFlag(args, "--dry-run");
    if (args.includes("--allow-state-write") || args.includes("--state-file") || args.includes("--run-record-dir")) {
      throw new TypeError("Dry-run mode cannot authorize state writes");
    }
    return { ...common, dryRun: true, allowNetwork: true };
  }
  if (!args.includes("--allow-state-write")) {
    throw new TypeError("Stateful scanning requires --allow-state-write");
  }
  assertSingleFlag(args, "--allow-state-write");
  return {
    ...common,
    dryRun: false,
    allowNetwork: true,
    allowStateWrite: true,
    statePath: readSingleValue(args, "--state-file"),
    runRecordDirectory: readSingleValue(args, "--run-record-dir"),
  };
}

export async function main(
  args: readonly string[],
  writeOutput: (value: string) => void = (value) => process.stdout.write(value),
  writeError: (value: string) => void = (value) => process.stderr.write(value),
  execute: (options: NetworkScanOptions) => Promise<NetworkScanReport> = runNetworkScan,
): Promise<number> {
  if (args.includes("--help")) {
    writeOutput(
      "Usage: npm run scan:competitive-footprint -- --config FILE --accounts FILE --allow-network (--dry-run | --allow-state-write --state-file FILE --run-record-dir DIRECTORY) [--at ISO_TIMESTAMP]\n",
    );
    return 0;
  }
  try {
    const report = await execute(parseNetworkScanArgs(args));
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

class AuthorizedFileStateStoreFactory implements StateStoreFactory {
  create(path: string): SignalStateStore {
    return new FileSignalStateStore({ path, allowWrite: true });
  }
}

class AuthorizedFileRunRecordStoreFactory implements RunRecordStoreFactory {
  create(directory: string): RunRecordStore {
    return new FileRunRecordStore({ directory, allowWrite: true });
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
  const booleanFlags = new Set(["--dry-run", "--allow-network", "--allow-state-write"]);
  const valueFlags = new Set(["--config", "--accounts", "--at", "--state-file", "--run-record-dir"]);
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

function toRunRecord(startedAt: string, result: RunResult): RunRecord {
  const failureCategories: Record<ErrorCategory, number> = {
    validation: 0,
    authorization: 0,
    rate_limited: 0,
    transient: 0,
    permanent: 0,
    conflict: 0,
  };
  for (const failure of result.failures) failureCategories[failure.category] += 1;
  return {
    schemaVersion: 1,
    framework: "competitive-footprint",
    mode: "network-stateful",
    runId: result.runId,
    startedAt,
    recordedAt: startedAt,
    dryRun: false,
    status: result.status,
    counts: {
      selected: result.selected,
      processed: result.processed,
      changed: result.changed,
      unchanged: result.unchanged,
      skipped: result.skipped,
      failed: result.failed,
    },
    failureCategories,
  };
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
