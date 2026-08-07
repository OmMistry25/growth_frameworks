import { readFile, stat } from "node:fs/promises";

import {
  accountSegments,
  ContractValidationError,
  signalStates,
  type Account,
  type CadenceRule,
  type CompetitiveFootprintConfig,
  validateAccount,
  validateConfig,
} from "@growth-frameworks/contracts/competitive-footprint";
import {
  validateDnsDetectorConfig,
  validateSubdomainDetectorConfig as validateSubdomainConfig,
  validateTcpDetectorConfig as validateTcpConfig,
  type DnsDetectorConfig,
  type NodeDnsResolverConfig,
  type SubdomainDetectorConfig,
  type TcpDetectorConfig,
} from "@growth-frameworks/probes";

const maximumInputBytes = 1_048_576;
const forbiddenKey = /(api.?key|credential|password|secret|token)/i;

export interface ExternalDnsDetector {
  readonly detector: DnsDetectorConfig;
  readonly resolver: NodeDnsResolverConfig;
}

export interface ExternalCompetitiveFootprintConfig {
  readonly schemaVersion: 1;
  readonly framework: CompetitiveFootprintConfig;
  readonly dns: readonly ExternalDnsDetector[];
  readonly subdomain: readonly SubdomainDetectorConfig[];
  readonly tcp: readonly TcpDetectorConfig[];
}

export interface ExternalAccountFile {
  readonly schemaVersion: 1;
  readonly dataPolicy: "synthetic-only" | "user-supplied";
  readonly accounts: readonly Account[];
}

export async function loadCompetitiveFootprintConfig(
  path: string,
): Promise<ExternalCompetitiveFootprintConfig> {
  return parseCompetitiveFootprintConfig(await readJsonFile(path));
}

export async function loadAccountFile(path: string): Promise<ExternalAccountFile> {
  return parseAccountFile(await readJsonFile(path));
}

export function parseCompetitiveFootprintConfig(input: unknown): ExternalCompetitiveFootprintConfig {
  assertNoSecretKeys(input);
  const root = object(input, "configuration");
  onlyKeys(root, ["schemaVersion", "framework", "detectors"], "configuration");
  if (root.schemaVersion !== 1) throw validation("configuration schemaVersion must equal 1");

  const frameworkInput = object(root.framework, "framework configuration");
  onlyKeys(frameworkInput, ["lossConfirmationCount", "cadence"], "framework configuration");
  const detectorsInput = object(root.detectors, "detector configuration");
  onlyKeys(detectorsInput, ["dns", "subdomain", "tcp"], "detector configuration");

  const dns = array(detectorsInput.dns, "DNS detectors").map(parseDnsDetector);
  const subdomain = array(detectorsInput.subdomain, "subdomain detectors").map((value, index) =>
    parseSubdomainDetector(value, index),
  );
  const tcp = array(detectorsInput.tcp, "TCP detectors").map((value, index) =>
    parseTcpDetector(value, index),
  );
  const detectorIds = [
    ...dns.map(({ detector }) => detector.id),
    ...subdomain.map(({ id }) => id),
    ...tcp.map(({ id }) => id),
  ];
  const cadence = parseCadence(frameworkInput.cadence);
  assertCompleteCadence(cadence);
  const framework = validateConfig({
    detectorIds,
    cadence,
    lossConfirmationCount: number(frameworkInput.lossConfirmationCount, "lossConfirmationCount"),
  });

  return { schemaVersion: 1, framework, dns, subdomain, tcp };
}

export function parseAccountFile(input: unknown): ExternalAccountFile {
  assertNoSecretKeys(input);
  const root = object(input, "account file");
  onlyKeys(root, ["schemaVersion", "dataPolicy", "accounts"], "account file");
  if (root.schemaVersion !== 1) throw validation("account file schemaVersion must equal 1");
  if (root.dataPolicy !== "synthetic-only" && root.dataPolicy !== "user-supplied") {
    throw validation("account file dataPolicy is invalid");
  }
  const accountInputs = array(root.accounts, "accounts");
  if (accountInputs.length === 0 || accountInputs.length > 10_000) {
    throw validation("account file requires between 1 and 10000 accounts");
  }
  const accounts = accountInputs.map((value, index) => {
    const candidate = object(value, `account ${index}`);
    onlyKeys(candidate, ["id", "displayName", "domain", "segment", "externalReferences"], `account ${index}`);
    if (candidate.externalReferences !== undefined) {
      for (const [referenceIndex, reference] of array(candidate.externalReferences, `account ${index} externalReferences`).entries()) {
        onlyKeys(
          object(reference, `account ${index} external reference ${referenceIndex}`),
          ["system", "id"],
          `account ${index} external reference ${referenceIndex}`,
        );
      }
    }
    return validateAccount(candidate as unknown as Account);
  });
  if (new Set(accounts.map(({ id }) => id)).size !== accounts.length) {
    throw validation("account ids must be unique");
  }
  return { schemaVersion: 1, dataPolicy: root.dataPolicy, accounts };
}

async function readJsonFile(path: string): Promise<unknown> {
  if (path.trim().length === 0) throw validation("input path is required");
  const details = await stat(path);
  if (!details.isFile()) throw validation("input path must reference a regular file");
  if (details.size > maximumInputBytes) throw validation("input file exceeds 1048576 bytes");
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw validation("input file must contain valid JSON");
    throw error;
  }
}

function parseDnsDetector(value: unknown, index: number): ExternalDnsDetector {
  const input = object(value, `DNS detector ${index}`);
  onlyKeys(input, ["detector", "resolver"], `DNS detector ${index}`);
  const resolver = object(input.resolver, `DNS detector ${index} resolver`);
  onlyKeys(resolver, ["timeoutMs", "tries"], `DNS detector ${index} resolver`);
  const detector = object(input.detector, `DNS detector ${index} configuration`);
  onlyKeys(
    detector,
    ["id", "rules", "negativeEvidenceCode", "timeoutEvidenceCode", "negativeConfidence"],
    `DNS detector ${index} configuration`,
  );
  for (const [ruleIndex, ruleValue] of array(detector.rules, `DNS detector ${index} rules`).entries()) {
    const rule = object(ruleValue, `DNS detector ${index} rule ${ruleIndex}`);
    onlyKeys(
      rule,
      ["hostnameTemplate", "recordType", "matcher", "evidenceCode", "confidence"],
      `DNS detector ${index} rule ${ruleIndex}`,
    );
    onlyKeys(
      object(rule.matcher, `DNS detector ${index} rule ${ruleIndex} matcher`),
      ["type", "value"],
      `DNS detector ${index} rule ${ruleIndex} matcher`,
    );
  }
  const config: NodeDnsResolverConfig = {
    timeoutMs: number(resolver.timeoutMs, `DNS detector ${index} timeoutMs`),
    tries: number(resolver.tries, `DNS detector ${index} tries`),
  };
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 30_000) {
    throw validation(`DNS detector ${index} timeoutMs is invalid`);
  }
  if (!Number.isInteger(config.tries) || config.tries < 1 || config.tries > 5) {
    throw validation(`DNS detector ${index} tries is invalid`);
  }
  return {
    detector: validateDnsDetectorConfig(detector as unknown as DnsDetectorConfig),
    resolver: config,
  };
}

function parseCadence(value: unknown): readonly CadenceRule[] {
  return array(value, "cadence").map((entry, index) => {
    const rule = object(entry, `cadence rule ${index}`);
    onlyKeys(rule, ["segment", "state", "intervalHours"], `cadence rule ${index}`);
    if (!accountSegments.includes(rule.segment as (typeof accountSegments)[number])) {
      throw validation(`cadence rule ${index} segment is invalid`);
    }
    if (!signalStates.includes(rule.state as (typeof signalStates)[number])) {
      throw validation(`cadence rule ${index} state is invalid`);
    }
    return {
      segment: rule.segment as CadenceRule["segment"],
      state: rule.state as CadenceRule["state"],
      intervalHours: number(rule.intervalHours, `cadence rule ${index} intervalHours`),
    };
  });
}

function assertCompleteCadence(cadence: readonly CadenceRule[]): void {
  const configured = new Set(cadence.map(({ segment, state }) => `${segment}:${state}`));
  const missing = accountSegments.flatMap((segment) =>
    signalStates
      .filter((state) => !configured.has(`${segment}:${state}`))
      .map((state) => `${segment}:${state}`),
  );
  if (missing.length > 0) throw validation(`cadence is missing rules: ${missing.join(", ")}`);
}

function parseSubdomainDetector(value: unknown, index: number): SubdomainDetectorConfig {
  const input = object(value, `subdomain detector ${index}`);
  onlyKeys(
    input,
    [
      "id",
      "rules",
      "timeoutMs",
      "maxRedirects",
      "maxResponseBytes",
      "negativeEvidenceCode",
      "timeoutEvidenceCode",
      "negativeConfidence",
    ],
    `subdomain detector ${index}`,
  );
  for (const [ruleIndex, ruleValue] of array(input.rules, `subdomain detector ${index} rules`).entries()) {
    onlyKeys(
      object(ruleValue, `subdomain detector ${index} rule ${ruleIndex}`),
      ["hostnameTemplate", "protocol", "path", "acceptedStatusCodes", "evidenceCode", "confidence"],
      `subdomain detector ${index} rule ${ruleIndex}`,
    );
  }
  return validateSubdomainConfig(input as unknown as SubdomainDetectorConfig);
}

function parseTcpDetector(value: unknown, index: number): TcpDetectorConfig {
  const input = object(value, `TCP detector ${index}`);
  onlyKeys(
    input,
    ["id", "rules", "timeoutMs", "negativeEvidenceCode", "timeoutEvidenceCode", "negativeConfidence"],
    `TCP detector ${index}`,
  );
  for (const [ruleIndex, ruleValue] of array(input.rules, `TCP detector ${index} rules`).entries()) {
    onlyKeys(
      object(ruleValue, `TCP detector ${index} rule ${ruleIndex}`),
      ["hostnameTemplate", "port", "tls", "evidenceCode", "confidence"],
      `TCP detector ${index} rule ${ruleIndex}`,
    );
  }
  return validateTcpConfig(input as unknown as TcpDetectorConfig);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw validation(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw validation(`${label} must be an array`);
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number") throw validation(`${label} must be a number`);
  return value;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw validation(`${label} contains unknown fields: ${unknown.join(", ")}`);
}

function assertNoSecretKeys(value: unknown, path = "configuration"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretKeys(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenKey.test(key)) throw validation(`${path} contains forbidden secret-like field: ${key}`);
    assertNoSecretKeys(entry, `${path}.${key}`);
  }
}

function validation(issue: string): ContractValidationError {
  return new ContractValidationError([issue]);
}
