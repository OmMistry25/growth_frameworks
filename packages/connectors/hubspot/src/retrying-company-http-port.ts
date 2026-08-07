import { PortOperationError } from "@growth-frameworks/contracts/competitive-footprint";

import type {
  HubSpotCompanyHttpPort,
  HubSpotCompanyHttpRequest,
  HubSpotCompanyHttpResponse,
} from "./company-account-source.ts";

export interface RetryingHubSpotCompanyHttpPortOptions {
  readonly http: HubSpotCompanyHttpPort;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maximumDelayMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export class RetryingHubSpotCompanyHttpPort implements HubSpotCompanyHttpPort {
  readonly #http: HubSpotCompanyHttpPort;
  readonly #maxAttempts: number;
  readonly #baseDelayMs: number;
  readonly #maximumDelayMs: number;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(options: RetryingHubSpotCompanyHttpPortOptions) {
    this.#http = options.http;
    this.#maxAttempts = boundedInteger(options.maxAttempts ?? 3, 1, 5, "retry attempts");
    this.#baseDelayMs = boundedInteger(options.baseDelayMs ?? 250, 10, 60_000, "retry base delay");
    this.#maximumDelayMs = boundedInteger(options.maximumDelayMs ?? 30_000, 10, 300_000, "maximum retry delay");
    if (this.#baseDelayMs > this.#maximumDelayMs) {
      throw new TypeError("HubSpot retry base delay must not exceed the maximum delay");
    }
    this.#sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async request(input: HubSpotCompanyHttpRequest): Promise<HubSpotCompanyHttpResponse> {
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      try {
        const response = await this.#http.request(input);
        if (!retryableStatus(response.status) || attempt === this.#maxAttempts) return response;
        await this.#sleep(retryDelay(response, attempt, this.#baseDelayMs, this.#maximumDelayMs));
      } catch (error) {
        if (attempt === this.#maxAttempts || (error instanceof PortOperationError && !error.retryable)) throw error;
        await this.#sleep(exponentialDelay(attempt, this.#baseDelayMs, this.#maximumDelayMs));
      }
    }
    throw new Error("unreachable");
  }
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 502 || status === 503 || status === 504;
}

function retryDelay(
  response: HubSpotCompanyHttpResponse,
  attempt: number,
  baseDelayMs: number,
  maximumDelayMs: number,
): number {
  if (
    response.status === 429 &&
    response.retryAfterSeconds !== undefined &&
    Number.isInteger(response.retryAfterSeconds) &&
    response.retryAfterSeconds >= 0
  ) {
    return Math.min(response.retryAfterSeconds * 1_000, maximumDelayMs);
  }
  return exponentialDelay(attempt, baseDelayMs, maximumDelayMs);
}

function exponentialDelay(attempt: number, baseDelayMs: number, maximumDelayMs: number): number {
  return Math.min(baseDelayMs * 2 ** (attempt - 1), maximumDelayMs);
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`HubSpot ${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}
