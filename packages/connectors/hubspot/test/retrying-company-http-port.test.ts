import assert from "node:assert/strict";
import test from "node:test";

import { PortOperationError } from "@growth-frameworks/contracts/competitive-footprint";

import type { HubSpotCompanyHttpRequest, HubSpotCompanyHttpResponse } from "../src/company-account-source.ts";
import { RetryingHubSpotCompanyHttpPort } from "../src/retrying-company-http-port.ts";

const request: HubSpotCompanyHttpRequest = {
  method: "GET",
  url: new URL("https://api.hubapi.com/crm/objects/2026-03/companies"),
  authorization: "Bearer synthetic-token-do-not-use",
  timeoutMs: 1_000,
};

test("retries transient responses with capped exponential delays", async () => {
  const delays: number[] = [];
  const http = new QueuePort([{ status: 503, body: null }, { status: 502, body: null }, { status: 200, body: {} }]);
  const retrying = new RetryingHubSpotCompanyHttpPort({
    http,
    maxAttempts: 3,
    baseDelayMs: 100,
    maximumDelayMs: 150,
    sleep: async (milliseconds) => { delays.push(milliseconds); },
  });
  assert.equal((await retrying.request(request)).status, 200);
  assert.equal(http.calls, 3);
  assert.deepEqual(delays, [100, 150]);
});

test("respects and caps Retry-After for rate limits", async () => {
  const delays: number[] = [];
  const retrying = new RetryingHubSpotCompanyHttpPort({
    http: new QueuePort([{ status: 429, body: null, retryAfterSeconds: 20 }, { status: 200, body: {} }]),
    maximumDelayMs: 5_000,
    sleep: async (milliseconds) => { delays.push(milliseconds); },
  });
  await retrying.request(request);
  assert.deepEqual(delays, [5_000]);
});

test("does not retry permanent responses or non-retryable port errors", async () => {
  const permanentResponse = new QueuePort([{ status: 401, body: null }]);
  const responsePort = new RetryingHubSpotCompanyHttpPort({ http: permanentResponse });
  assert.equal((await responsePort.request(request)).status, 401);
  assert.equal(permanentResponse.calls, 1);

  const permanentError = new ThrowingPort(new PortOperationError("rejected", "authorization", false));
  const errorPort = new RetryingHubSpotCompanyHttpPort({ http: permanentError });
  await assert.rejects(() => errorPort.request(request), /rejected/);
  assert.equal(permanentError.calls, 1);
});

test("stops after the configured attempt cap", async () => {
  const http = new QueuePort([{ status: 503, body: null }, { status: 503, body: null }]);
  const retrying = new RetryingHubSpotCompanyHttpPort({ http, maxAttempts: 2, sleep: async () => {} });
  assert.equal((await retrying.request(request)).status, 503);
  assert.equal(http.calls, 2);
});

class QueuePort {
  calls = 0;
  readonly #responses: HubSpotCompanyHttpResponse[];
  constructor(responses: readonly HubSpotCompanyHttpResponse[]) { this.#responses = [...responses]; }
  async request(_input: HubSpotCompanyHttpRequest): Promise<HubSpotCompanyHttpResponse> {
    this.calls += 1;
    const response = this.#responses.shift();
    if (response === undefined) throw new Error("queue exhausted");
    return response;
  }
}

class ThrowingPort {
  calls = 0;
  readonly #error: Error;
  constructor(error: Error) { this.#error = error; }
  async request(): Promise<HubSpotCompanyHttpResponse> {
    this.calls += 1;
    throw this.#error;
  }
}
