import type { Account, AccountSegment, AccountSource, RunContext } from "@growth-frameworks/contracts/competitive-footprint";
import {
  accountSegments,
  ContractValidationError,
  normalizeDomain,
  PortOperationError,
  validateAccount,
} from "@growth-frameworks/contracts/competitive-footprint";

import { parseHubSpotCompanyPage, type HubSpotCompanyRecord } from "./company-mapping.ts";
import type { HubSpotCompanyHttpPort, HubSpotCompanyHttpResponse } from "./company-account-source.ts";

export interface HubSpotSingleCompanyAccountSourceOptions {
  readonly accessToken: string;
  readonly companyId: string;
  readonly expectedDomain: string;
  readonly segment: AccountSegment;
  readonly http: HubSpotCompanyHttpPort;
  readonly timeoutMs?: number;
}

const companyIdPattern = /^\d{1,32}$/;

export class HubSpotSingleCompanyAccountSource implements AccountSource {
  readonly #accessToken: string;
  readonly #companyId: string;
  readonly #expectedDomain: string;
  readonly #segment: AccountSegment;
  readonly #http: HubSpotCompanyHttpPort;
  readonly #timeoutMs: number;

  constructor(options: HubSpotSingleCompanyAccountSourceOptions) {
    if (!companyIdPattern.test(options.companyId)) throw new TypeError("HubSpot canary company ID must be numeric");
    if (!accountSegments.includes(options.segment)) throw new TypeError("HubSpot canary segment is invalid");
    if (
      options.accessToken.length < 8 ||
      options.accessToken.length > 512 ||
      options.accessToken.trim() !== options.accessToken ||
      /[\u0000-\u0020\u007f]/.test(options.accessToken)
    ) {
      throw new PortOperationError("HubSpot access token is invalid", "authorization", false);
    }
    this.#accessToken = options.accessToken;
    this.#companyId = options.companyId;
    this.#expectedDomain = normalizeDomain(options.expectedDomain);
    this.#segment = options.segment;
    this.#http = options.http;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 100 || this.#timeoutMs > 30_000) {
      throw new TypeError("HubSpot canary timeout must be an integer from 100 to 30000 milliseconds");
    }
  }

  async *listAccounts(_context: RunContext): AsyncIterable<Account> {
    const url = new URL(`https://api.hubapi.com/crm/objects/2026-03/companies/${this.#companyId}`);
    url.searchParams.set("properties", "name,domain");
    let response: HubSpotCompanyHttpResponse;
    try {
      response = await this.#http.request({
        method: "GET",
        url,
        authorization: `Bearer ${this.#accessToken}`,
        timeoutMs: this.#timeoutMs,
      });
    } catch (error) {
      if (error instanceof PortOperationError) {
        throw new PortOperationError("HubSpot canary request failed", error.category, error.retryable, { cause: error });
      }
      throw new PortOperationError("HubSpot canary request failed", "transient", true, { cause: error });
    }
    if (response.status !== 200) throw responseError(response.status);
    const record = parseSingleRecord(response.body);
    if (record.id !== this.#companyId) {
      throw new ContractValidationError(["HubSpot canary response company ID did not match the allowlist"]);
    }
    if (record.archived === true) throw new ContractValidationError(["HubSpot canary company is archived"]);
    const name = requiredProperty(record, "name");
    const domain = normalizeDomain(requiredProperty(record, "domain"));
    if (domain !== this.#expectedDomain) {
      throw new ContractValidationError(["HubSpot canary company domain did not match the allowlist"]);
    }
    yield validateAccount({
      id: `hubspot:company:${this.#companyId}`,
      displayName: name,
      domain,
      segment: this.#segment,
      externalReferences: [{ system: "hubspot", id: this.#companyId }],
    });
  }
}

function parseSingleRecord(input: unknown): HubSpotCompanyRecord {
  const page = parseHubSpotCompanyPage({ results: [input] });
  const record = page.results[0];
  if (record === undefined) throw new ContractValidationError(["HubSpot canary response was empty"]);
  return record;
}

function requiredProperty(record: HubSpotCompanyRecord, name: string): string {
  const value = record.properties[name];
  if (value === undefined || value === null || value.trim().length === 0) {
    throw new ContractValidationError([`HubSpot canary company property ${name} is required`]);
  }
  return value.trim();
}

function responseError(status: number): PortOperationError {
  if (status === 401 || status === 403) return new PortOperationError(`HubSpot canary request failed with HTTP ${status}`, "authorization", false);
  if (status === 429) return new PortOperationError("HubSpot canary request was rate limited", "rate_limited", true);
  if (status === 408 || status === 425 || status === 502 || status === 503 || status === 504) {
    return new PortOperationError(`HubSpot canary request failed with HTTP ${status}`, "transient", true);
  }
  return new PortOperationError(`HubSpot canary request failed with HTTP ${status}`, "permanent", false);
}
