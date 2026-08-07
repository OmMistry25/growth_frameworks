import { readFile, stat } from "node:fs/promises";

import {
  validateHubSpotCompanyMappingConfig,
  type HubSpotCompanyMappingConfig,
} from "@growth-frameworks/hubspot";

const maximumInputBytes = 65_536;
const forbiddenKey = /(api.?key|authorization|client.?secret|credential|password|private.?key|refresh.?token|secret|token|webhook)/i;

export interface ExternalHubSpotSourceConfig {
  readonly schemaVersion: 1;
  readonly mapping: HubSpotCompanyMappingConfig;
  readonly request: Readonly<{
    readonly pageSize: number;
    readonly maxPages: number;
    readonly timeoutMs: number;
  }>;
  readonly retry: Readonly<{
    readonly maxAttempts: number;
    readonly baseDelayMs: number;
    readonly maximumDelayMs: number;
  }>;
}

export async function loadHubSpotSourceConfig(path: string): Promise<ExternalHubSpotSourceConfig> {
  if (path.trim().length === 0) throw new TypeError("HubSpot configuration path is required");
  const details = await stat(path);
  if (!details.isFile()) throw new TypeError("HubSpot configuration path must reference a regular file");
  if (details.size > maximumInputBytes) throw new TypeError("HubSpot configuration exceeds 65536 bytes");
  let input: unknown;
  try {
    input = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new TypeError("HubSpot configuration must contain valid JSON");
    throw error;
  }
  return parseHubSpotSourceConfig(input);
}

export function parseHubSpotSourceConfig(input: unknown): ExternalHubSpotSourceConfig {
  assertNoSecretKeys(input);
  const root = object(input, "HubSpot configuration");
  onlyKeys(root, ["schemaVersion", "mapping", "request", "retry"], "HubSpot configuration");
  if (root.schemaVersion !== 1) throw new TypeError("HubSpot configuration schemaVersion must equal 1");

  const mappingInput = object(root.mapping, "HubSpot mapping");
  onlyKeys(mappingInput, ["properties", "segmentValues"], "HubSpot mapping");
  const properties = object(mappingInput.properties, "HubSpot mapping properties");
  onlyKeys(properties, ["displayName", "domain", "segment"], "HubSpot mapping properties");
  const segmentValues = object(mappingInput.segmentValues, "HubSpot segment values");
  const mapping = validateHubSpotCompanyMappingConfig({
    properties: {
      displayName: string(properties.displayName, "HubSpot displayName property"),
      domain: string(properties.domain, "HubSpot domain property"),
      segment: string(properties.segment, "HubSpot segment property"),
    },
    segmentValues: segmentValues as HubSpotCompanyMappingConfig["segmentValues"],
  });

  const request = object(root.request, "HubSpot request configuration");
  onlyKeys(request, ["pageSize", "maxPages", "timeoutMs"], "HubSpot request configuration");
  const retry = object(root.retry, "HubSpot retry configuration");
  onlyKeys(retry, ["maxAttempts", "baseDelayMs", "maximumDelayMs"], "HubSpot retry configuration");

  return {
    schemaVersion: 1,
    mapping,
    request: {
      pageSize: boundedInteger(request.pageSize, 1, 100, "HubSpot pageSize"),
      maxPages: boundedInteger(request.maxPages, 1, 1_000, "HubSpot maxPages"),
      timeoutMs: boundedInteger(request.timeoutMs, 100, 30_000, "HubSpot timeoutMs"),
    },
    retry: {
      maxAttempts: boundedInteger(retry.maxAttempts, 1, 5, "HubSpot maxAttempts"),
      baseDelayMs: boundedInteger(retry.baseDelayMs, 10, 60_000, "HubSpot baseDelayMs"),
      maximumDelayMs: boundedInteger(retry.maximumDelayMs, 10, 300_000, "HubSpot maximumDelayMs"),
    },
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new TypeError(`${label} contains unknown fields: ${unknown.join(", ")}`);
}

function assertNoSecretKeys(value: unknown, path = "HubSpot configuration"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretKeys(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenKey.test(key)) throw new TypeError(`${path} contains forbidden secret-like field: ${key}`);
    assertNoSecretKeys(entry, `${path}.${key}`);
  }
}
