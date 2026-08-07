import type { Account, AccountSegment } from "@growth-frameworks/contracts/competitive-footprint";
import {
  accountSegments,
  ContractValidationError,
  validateAccount,
} from "@growth-frameworks/contracts/competitive-footprint";

export interface HubSpotCompanyRecord {
  readonly id: string;
  readonly properties: Readonly<Record<string, string | null>>;
  readonly archived?: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface HubSpotCompanyPage {
  readonly results: readonly HubSpotCompanyRecord[];
  readonly paging?: Readonly<{
    readonly next?: Readonly<{ readonly after: string; readonly link?: string }>;
  }>;
}

export interface HubSpotCompanyMappingConfig {
  readonly properties: Readonly<{
    readonly displayName: string;
    readonly domain: string;
    readonly segment: string;
  }>;
  readonly segmentValues: Readonly<Record<string, AccountSegment>>;
}

const propertyName = /^[a-zA-Z][a-zA-Z0-9_]{0,127}$/;
const recordId = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const secretLikeName = /(access.?token|api.?key|authorization|client.?secret|password|private.?key|refresh.?token|secret|webhook)/i;

export function validateHubSpotCompanyMappingConfig(
  input: HubSpotCompanyMappingConfig,
): HubSpotCompanyMappingConfig {
  const configuredProperties = [
    input.properties.displayName,
    input.properties.domain,
    input.properties.segment,
  ];
  if (configuredProperties.some((name) => !propertyName.test(name))) {
    throw new TypeError("HubSpot mapping property names must be valid internal names");
  }
  if (configuredProperties.some((name) => secretLikeName.test(name))) {
    throw new TypeError("HubSpot mapping must not reference secret-like properties");
  }
  if (new Set(configuredProperties).size !== configuredProperties.length) {
    throw new TypeError("HubSpot mapping properties must be unique");
  }

  const entries = Object.entries(input.segmentValues);
  if (entries.length === 0) throw new TypeError("HubSpot segment mapping must not be empty");
  for (const [sourceValue, segment] of entries) {
    if (sourceValue.length === 0 || sourceValue.trim() !== sourceValue || sourceValue.length > 128) {
      throw new TypeError("HubSpot segment source values must be non-empty, trimmed, and at most 128 characters");
    }
    if (!accountSegments.includes(segment)) {
      throw new TypeError("HubSpot segment mapping contains an invalid canonical segment");
    }
  }
  return input;
}

export function mapHubSpotCompanyToAccount(
  record: HubSpotCompanyRecord,
  config: HubSpotCompanyMappingConfig,
): Account {
  validateHubSpotCompanyMappingConfig(config);
  const issues: string[] = [];
  if (!recordId.test(record.id)) issues.push("HubSpot company id is invalid");
  if (record.archived === true) issues.push("HubSpot company is archived");

  const displayName = readRequiredProperty(record, config.properties.displayName, issues);
  const domain = readRequiredProperty(record, config.properties.domain, issues);
  const segmentValue = readRequiredProperty(record, config.properties.segment, issues);
  const segment = config.segmentValues[segmentValue];
  if (segment === undefined && segmentValue.length > 0) {
    issues.push(`HubSpot segment property ${config.properties.segment} is not mapped`);
  }
  if (issues.length > 0) throw new ContractValidationError(issues);

  return validateAccount({
    id: `hubspot:company:${record.id}`,
    displayName,
    domain,
    segment: segment as AccountSegment,
    externalReferences: [{ system: "hubspot", id: record.id }],
  });
}

export function parseHubSpotCompanyPage(input: unknown): HubSpotCompanyPage {
  if (!isObject(input) || !Array.isArray(input.results)) {
    throw new ContractValidationError(["HubSpot company page results must be an array"]);
  }
  const results = input.results.map(parseCompanyRecord);
  const paging = parsePaging(input.paging);
  return paging === undefined ? { results } : { results, paging };
}

function parseCompanyRecord(input: unknown): HubSpotCompanyRecord {
  if (!isObject(input) || typeof input.id !== "string" || !isObject(input.properties)) {
    throw new ContractValidationError(["HubSpot company record shape is invalid"]);
  }
  const properties: Record<string, string | null> = {};
  for (const [name, value] of Object.entries(input.properties)) {
    if (typeof value !== "string" && value !== null) {
      throw new ContractValidationError([`HubSpot company property ${name} must be a string or null`]);
    }
    properties[name] = value;
  }
  if (input.archived !== undefined && typeof input.archived !== "boolean") {
    throw new ContractValidationError(["HubSpot company archived flag must be boolean"]);
  }
  for (const field of ["createdAt", "updatedAt"] as const) {
    if (input[field] !== undefined && (typeof input[field] !== "string" || Number.isNaN(Date.parse(input[field])))) {
      throw new ContractValidationError([`HubSpot company ${field} must be an ISO timestamp`]);
    }
  }
  return {
    id: input.id,
    properties,
    ...(input.archived === undefined ? {} : { archived: input.archived }),
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt as string }),
    ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt as string }),
  };
}

function parsePaging(input: unknown): HubSpotCompanyPage["paging"] {
  if (input === undefined) return undefined;
  if (!isObject(input) || (input.next !== undefined && !isObject(input.next))) {
    throw new ContractValidationError(["HubSpot company page paging is invalid"]);
  }
  if (input.next === undefined) return {};
  if (typeof input.next.after !== "string" || input.next.after.length === 0) {
    throw new ContractValidationError(["HubSpot company page next cursor is invalid"]);
  }
  if (input.next.link !== undefined && typeof input.next.link !== "string") {
    throw new ContractValidationError(["HubSpot company page next link is invalid"]);
  }
  return { next: { after: input.next.after, ...(input.next.link === undefined ? {} : { link: input.next.link }) } };
}

function readRequiredProperty(
  record: HubSpotCompanyRecord,
  property: string,
  issues: string[],
): string {
  const value = record.properties[property];
  if (value === undefined || value === null || value.trim().length === 0) {
    issues.push(`HubSpot company property ${property} is required`);
    return "";
  }
  return value.trim();
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
