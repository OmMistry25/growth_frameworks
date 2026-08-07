import assert from "node:assert/strict";
import test from "node:test";

import type { RunContext } from "@growth-frameworks/contracts/competitive-footprint";
import { PortOperationError } from "@growth-frameworks/contracts/competitive-footprint";

import {
  HubSpotCompanyAccountSource,
  type HubSpotCompanyHttpPort,
  type HubSpotCompanyHttpRequest,
  type HubSpotCompanyHttpResponse,
} from "../src/company-account-source.ts";

const syntheticToken = "synthetic-token-do-not-use";
const context: RunContext = { runId: "run:synthetic", startedAt: "2026-08-07T12:00:00.000Z", dryRun: true };
const mapping = {
  properties: { displayName: "name", domain: "domain", segment: "monitoring_tier" },
  segmentValues: { tier_1: "high_priority", tier_2: "standard" },
} as const;

test("reads bounded pages through the injected port and yields canonical accounts", async () => {
  const http = new QueueHttp([
    pageResponse("1", "One", "one.example", "tier_1", "cursor-2"),
    pageResponse("2", "Two", "two.example", "tier_2"),
  ]);
  const source = new HubSpotCompanyAccountSource({ accessToken: syntheticToken, mapping, http, pageSize: 25 });

  const accounts = await collect(source.listAccounts(context));
  assert.deepEqual(accounts.map(({ id, segment }) => ({ id, segment })), [
    { id: "hubspot:company:1", segment: "high_priority" },
    { id: "hubspot:company:2", segment: "standard" },
  ]);
  assert.equal(http.requests.length, 2);
  assert.equal(http.requests[0]?.method, "GET");
  assert.equal(http.requests[0]?.url.origin, "https://api.hubapi.com");
  assert.equal(http.requests[0]?.url.pathname, "/crm/objects/2026-03/companies");
  assert.equal(http.requests[0]?.url.searchParams.get("limit"), "25");
  assert.equal(http.requests[0]?.url.searchParams.get("archived"), "false");
  assert.equal(http.requests[0]?.url.searchParams.get("properties"), "name,domain,monitoring_tier");
  assert.equal(http.requests[0]?.url.searchParams.has("after"), false);
  assert.equal(http.requests[1]?.url.searchParams.get("after"), "cursor-2");
  assert.equal(http.requests[0]?.authorization, `Bearer ${syntheticToken}`);
  assert.equal(http.requests[0]?.timeoutMs, 5_000);
});

test("stops before an unbounded page sequence or repeated cursor", async () => {
  const limited = new HubSpotCompanyAccountSource({
    accessToken: syntheticToken,
    mapping,
    http: new QueueHttp([pageResponse("1", "One", "one.example", "tier_1", "next")]),
    maxPages: 1,
  });
  await assert.rejects(() => collect(limited.listAccounts(context)), /configured page limit/);

  const repeated = new HubSpotCompanyAccountSource({
    accessToken: syntheticToken,
    mapping,
    http: new QueueHttp([
      pageResponse("1", "One", "one.example", "tier_1", "same"),
      pageResponse("2", "Two", "two.example", "tier_2", "same"),
    ]),
  });
  await assert.rejects(() => collect(repeated.listAccounts(context)), /cursor repeated/);
});

test("categorizes authorization, rate-limit, transient, and permanent responses", async () => {
  for (const testCase of [
    { response: { status: 401, body: {} }, category: "authorization", retryable: false },
    { response: { status: 429, body: {}, retryAfterSeconds: 4 }, category: "rate_limited", retryable: true },
    { response: { status: 503, body: {} }, category: "transient", retryable: true },
    { response: { status: 400, body: {} }, category: "permanent", retryable: false },
  ] as const) {
    const source = new HubSpotCompanyAccountSource({
      accessToken: syntheticToken,
      mapping,
      http: new QueueHttp([testCase.response]),
    });
    await assert.rejects(
      () => collect(source.listAccounts(context)),
      (error: unknown) =>
        error instanceof PortOperationError &&
        error.category === testCase.category &&
        error.retryable === testCase.retryable &&
        !error.message.includes(syntheticToken),
    );
  }
});

test("wraps transport failures without exposing secrets or provider payloads", async () => {
  const http: HubSpotCompanyHttpPort = {
    request: async () => {
      throw new Error(`socket failed for ${syntheticToken}`);
    },
  };
  const source = new HubSpotCompanyAccountSource({ accessToken: syntheticToken, mapping, http });
  await assert.rejects(
    () => collect(source.listAccounts(context)),
    (error: unknown) =>
      error instanceof PortOperationError &&
      error.category === "transient" &&
      error.retryable &&
      error.message === "HubSpot company request failed",
  );
});

test("fails closed on invalid records, tokens, and request bounds", async () => {
  const source = new HubSpotCompanyAccountSource({
    accessToken: syntheticToken,
    mapping,
    http: new QueueHttp([{ status: 200, body: { results: [{ id: "1", properties: { name: null } }] } }]),
  });
  await assert.rejects(() => collect(source.listAccounts(context)), /property name is required/);

  for (const options of [
    { accessToken: "short", pageSize: 100 },
    { accessToken: syntheticToken, pageSize: 0 },
    { accessToken: syntheticToken, maxPages: 1_001 },
    { accessToken: syntheticToken, timeoutMs: 30_001 },
  ]) {
    assert.throws(
      () => new HubSpotCompanyAccountSource({ ...options, mapping, http: new QueueHttp([]) }),
      /HubSpot/,
    );
  }
});

class QueueHttp implements HubSpotCompanyHttpPort {
  readonly requests: HubSpotCompanyHttpRequest[] = [];
  readonly #responses: HubSpotCompanyHttpResponse[];

  constructor(responses: readonly HubSpotCompanyHttpResponse[]) {
    this.#responses = [...responses];
  }

  async request(input: HubSpotCompanyHttpRequest): Promise<HubSpotCompanyHttpResponse> {
    this.requests.push(input);
    const response = this.#responses.shift();
    if (response === undefined) throw new Error("synthetic response queue exhausted");
    return response;
  }
}

function pageResponse(
  id: string,
  name: string,
  domain: string,
  segment: string,
  after?: string,
): HubSpotCompanyHttpResponse {
  return {
    status: 200,
    body: {
      results: [{ id, properties: { name, domain, monitoring_tier: segment }, archived: false }],
      ...(after === undefined ? {} : { paging: { next: { after, link: `https://ignored.example/?after=${after}` } } }),
    },
  };
}

async function collect<T>(input: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of input) values.push(value);
  return values;
}
