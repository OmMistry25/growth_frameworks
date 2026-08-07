import type {
  Account,
  AccountSource,
  ErrorCategory,
  RunContext,
} from "@growth-frameworks/contracts/competitive-footprint";
import { PortOperationError } from "@growth-frameworks/contracts/competitive-footprint";

import {
  mapHubSpotCompanyToAccount,
  parseHubSpotCompanyPage,
  validateHubSpotCompanyMappingConfig,
  type HubSpotCompanyMappingConfig,
} from "./company-mapping.ts";

export interface HubSpotCompanyHttpRequest {
  readonly method: "GET";
  readonly url: URL;
  readonly authorization: string;
  readonly timeoutMs: number;
}

export interface HubSpotCompanyHttpResponse {
  readonly status: number;
  readonly body: unknown;
  readonly retryAfterSeconds?: number;
}

export interface HubSpotCompanyHttpPort {
  request(input: HubSpotCompanyHttpRequest): Promise<HubSpotCompanyHttpResponse>;
}

export interface HubSpotCompanyAccountSourceOptions {
  readonly accessToken: string;
  readonly mapping: HubSpotCompanyMappingConfig;
  readonly http: HubSpotCompanyHttpPort;
  readonly pageSize?: number;
  readonly maxPages?: number;
  readonly timeoutMs?: number;
}

const companiesEndpoint = "https://api.hubapi.com/crm/objects/2026-03/companies";

export class HubSpotCompanyAccountSource implements AccountSource {
  readonly #accessToken: string;
  readonly #mapping: HubSpotCompanyMappingConfig;
  readonly #http: HubSpotCompanyHttpPort;
  readonly #pageSize: number;
  readonly #maxPages: number;
  readonly #timeoutMs: number;

  constructor(options: HubSpotCompanyAccountSourceOptions) {
    if (
      options.accessToken.length < 8 ||
      options.accessToken.length > 512 ||
      options.accessToken.trim() !== options.accessToken ||
      /[\u0000-\u0020\u007f]/.test(options.accessToken)
    ) {
      throw new PortOperationError("HubSpot access token is invalid", "authorization", false);
    }
    this.#accessToken = options.accessToken;
    this.#mapping = validateHubSpotCompanyMappingConfig(options.mapping);
    this.#http = options.http;
    this.#pageSize = boundedInteger(options.pageSize ?? 100, 1, 100, "page size");
    this.#maxPages = boundedInteger(options.maxPages ?? 100, 1, 1_000, "maximum pages");
    this.#timeoutMs = boundedInteger(options.timeoutMs ?? 5_000, 100, 30_000, "timeout");
  }

  async *listAccounts(_context: RunContext): AsyncIterable<Account> {
    let after: string | undefined;
    const seenCursors = new Set<string>();

    for (let pageNumber = 1; pageNumber <= this.#maxPages; pageNumber += 1) {
      const response = await this.#requestPage(after);
      if (response.status !== 200) throw responseError(response);

      const page = parseHubSpotCompanyPage(response.body);
      for (const record of page.results) yield mapHubSpotCompanyToAccount(record, this.#mapping);

      const next = page.paging?.next?.after;
      if (next === undefined) return;
      if (seenCursors.has(next) || next === after) {
        throw new PortOperationError("HubSpot pagination cursor repeated", "permanent", false);
      }
      seenCursors.add(next);
      after = next;
    }
    throw new PortOperationError("HubSpot pagination exceeded the configured page limit", "permanent", false);
  }

  async #requestPage(after: string | undefined): Promise<HubSpotCompanyHttpResponse> {
    const url = new URL(companiesEndpoint);
    url.searchParams.set("limit", String(this.#pageSize));
    url.searchParams.set("archived", "false");
    url.searchParams.set(
      "properties",
      [this.#mapping.properties.displayName, this.#mapping.properties.domain, this.#mapping.properties.segment].join(","),
    );
    if (after !== undefined) url.searchParams.set("after", after);

    try {
      return await this.#http.request({
        method: "GET",
        url,
        authorization: `Bearer ${this.#accessToken}`,
        timeoutMs: this.#timeoutMs,
      });
    } catch (error) {
      if (error instanceof PortOperationError) {
        throw new PortOperationError("HubSpot company request failed", error.category, error.retryable, { cause: error });
      }
      throw new PortOperationError("HubSpot company request failed", "transient", true, { cause: error });
    }
  }
}

function responseError(response: HubSpotCompanyHttpResponse): PortOperationError {
  const [category, retryable] = categorizeStatus(response.status);
  const retrySuffix =
    response.status === 429 && validRetryAfter(response.retryAfterSeconds)
      ? `; retry after ${response.retryAfterSeconds} seconds`
      : "";
  return new PortOperationError(
    `HubSpot company request failed with HTTP ${response.status}${retrySuffix}`,
    category,
    retryable,
  );
}

function categorizeStatus(status: number): readonly [ErrorCategory, boolean] {
  if (status === 401 || status === 403) return ["authorization", false];
  if (status === 429) return ["rate_limited", true];
  if (status === 408 || status === 425 || status === 502 || status === 503 || status === 504) {
    return ["transient", true];
  }
  return ["permanent", false];
}

function validRetryAfter(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 0 && value <= 86_400;
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`HubSpot ${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}
