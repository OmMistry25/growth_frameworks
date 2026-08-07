#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import type { Account, AccountSegment, AccountSource } from "@growth-frameworks/contracts/competitive-footprint";
import { normalizeDomain, validateAccount } from "@growth-frameworks/contracts/competitive-footprint";
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

import { loadCompetitiveFootprintConfig } from "./external-input.ts";
import { NoWriteDestination, NoWriteStateStore } from "./no-write-adapters.ts";
import { redactCanaryResult, type RedactedCanaryResult } from "./redacted-canary-result.ts";

export interface ProbeCanaryOptions {
  readonly configPath: string;
  readonly expectedDomain: string;
  readonly segment: AccountSegment;
  readonly at: string;
  readonly dryRun: true;
  readonly allowNetwork: true;
  readonly probeOnlyCanary: true;
}

export interface ProbeCanaryReport {
  readonly command: "competitive-footprint";
  readonly mode: "exact-domain-probe-only-canary";
  readonly crmAccessEnabled: false;
  readonly stateWriteEnabled: false;
  readonly deliveryEnabled: false;
  readonly exactDomainCount: 1;
  readonly result: RedactedCanaryResult;
}

export interface ProbeCanaryAdapterFactory {
  createDnsResolver(config: NodeDnsResolverConfig): DnsResolverPort;
  createHttpProbeClient(): HttpProbeClientPort;
  createTcpProbeClient(): TcpProbeClientPort;
}

export async function runProbeCanary(
  options: ProbeCanaryOptions,
  adapters: ProbeCanaryAdapterFactory = new NodeProbeCanaryAdapterFactory(),
): Promise<ProbeCanaryReport> {
  if (options.dryRun !== true || options.allowNetwork !== true || options.probeOnlyCanary !== true) {
    throw new TypeError("Probe-only canary requires all explicit safety gates");
  }
  const runAt = new Date(options.at);
  if (Number.isNaN(runAt.getTime())) throw new TypeError("Probe-only canary time must be a valid ISO timestamp");
  const domain = normalizeDomain(options.expectedDomain);
  const configuration = await loadCompetitiveFootprintConfig(options.configPath);
  const detectors = [
    ...configuration.dns.map(({ detector, resolver }) => new DnsSignalDetector(detector, adapters.createDnsResolver(resolver))),
    ...configuration.subdomain.map((detector) => new SubdomainSignalDetector(detector, adapters.createHttpProbeClient())),
    ...configuration.tcp.map((detector) => new TcpSignalDetector(detector, adapters.createTcpProbeClient())),
  ];
  const account = validateAccount({ id: "probe-canary:allowlisted", displayName: "Redacted canary", domain, segment: options.segment });
  const startedAt = runAt.toISOString();
  const result = await runCompetitiveFootprint(
    { runId: `probe-only-canary:${startedAt}`, startedAt, dryRun: true },
    configuration.framework,
    {
      accountSource: new SingleAccountSource(account),
      detectors,
      stateStore: new NoWriteStateStore(),
      destinations: [new NoWriteDestination()],
      clock: { now: () => runAt },
      transitionPolicy: () => ({ lossCriteriaSatisfied: false, historicalEvidenceOnly: false }),
    },
  );
  return {
    command: "competitive-footprint",
    mode: "exact-domain-probe-only-canary",
    crmAccessEnabled: false,
    stateWriteEnabled: false,
    deliveryEnabled: false,
    exactDomainCount: 1,
    result: redactCanaryResult(result, configuration.framework.detectorIds),
  };
}

export function parseProbeCanaryArgs(args: readonly string[]): ProbeCanaryOptions {
  const booleanFlags = ["--dry-run", "--allow-network", "--probe-only-canary"] as const;
  const valueFlags = ["--config", "--expected-domain", "--segment", "--at"] as const;
  validateTokens(args, new Set(booleanFlags), new Set(valueFlags));
  for (const flag of booleanFlags) {
    if (args.filter((value) => value === flag).length !== 1) throw new TypeError(`Probe-only canary requires ${flag} exactly once`);
  }
  const segment = readSingleValue(args, "--segment");
  if (segment !== "high_priority" && segment !== "standard" && segment !== "low_priority") throw new TypeError("--segment is invalid");
  return {
    configPath: readSingleValue(args, "--config"),
    expectedDomain: normalizeDomain(readSingleValue(args, "--expected-domain")),
    segment,
    at: readOptionalValue(args, "--at") ?? new Date().toISOString(),
    dryRun: true,
    allowNetwork: true,
    probeOnlyCanary: true,
  };
}

export async function main(
  args: readonly string[],
  writeOutput: (value: string) => void = (value) => process.stdout.write(value),
  writeError: (value: string) => void = (value) => process.stderr.write(value),
  execute: (options: ProbeCanaryOptions) => Promise<ProbeCanaryReport> = runProbeCanary,
): Promise<number> {
  try {
    const report = await execute(parseProbeCanaryArgs(args));
    writeOutput(`${JSON.stringify(report, null, 2)}\n`);
    return report.result.status === "succeeded" ? 0 : 1;
  } catch (error) {
    writeError(`${error instanceof Error ? error.message : "Probe-only canary failed"}\n`);
    return 1;
  }
}

class NodeProbeCanaryAdapterFactory implements ProbeCanaryAdapterFactory {
  readonly #publicAddresses = new NodePublicAddressResolver();
  createDnsResolver(config: NodeDnsResolverConfig): DnsResolverPort { return new NodeDnsResolver(config); }
  createHttpProbeClient(): HttpProbeClientPort { return new NodeHttpProbeClient(this.#publicAddresses); }
  createTcpProbeClient(): TcpProbeClientPort { return new NodeTcpProbeClient(this.#publicAddresses); }
}

class SingleAccountSource implements AccountSource {
  readonly #account: Account;
  constructor(account: Account) { this.#account = account; }
  async *listAccounts() { yield this.#account; }
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
