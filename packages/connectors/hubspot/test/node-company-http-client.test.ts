import assert from "node:assert/strict";
import test from "node:test";

import { PortOperationError } from "@growth-frameworks/contracts/competitive-footprint";

import { NodeHubSpotCompanyHttpClient } from "../src/node-company-http-client.ts";

const request = {
  method: "GET",
  url: new URL("https://api.hubapi.com/crm/objects/2026-03/companies?limit=10&archived=false&properties=name%2Cdomain%2Cmonitoring_tier"),
  authorization: "Bearer synthetic-token-do-not-use",
  timeoutMs: 1_000,
} as const;

test("performs a fixed-origin GET with bearer authorization and parses bounded JSON", async () => {
  const calls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
  const client = new NodeHubSpotCompanyHttpClient({
    fetch: async (input, init) => {
      calls.push({ input, init });
      return new Response('{"results":[]}', { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.deepEqual(await client.request(request), { status: 200, body: { results: [] } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.init?.method, "GET");
  assert.equal(new Headers(calls[0]?.init?.headers).get("authorization"), request.authorization);
  assert.equal(calls[0]?.init?.redirect, "error");
});

test("allows only a numeric company ID on the single-record endpoint", async () => {
  const client = new NodeHubSpotCompanyHttpClient({ fetch: async () => new Response("{}") });
  await client.request({ ...request, url: new URL("https://api.hubapi.com/crm/objects/2026-03/companies/336132462329?properties=name%2Cdomain") });
  await assert.rejects(
    () => client.request({ ...request, url: new URL("https://api.hubapi.com/crm/objects/2026-03/companies/all?properties=name%2Cdomain") }),
    /not approved/,
  );
});

test("parses a bounded Retry-After header without reading provider error fields", async () => {
  const client = new NodeHubSpotCompanyHttpClient({
    fetch: async () => new Response('{"message":"ignored"}', { status: 429, headers: { "retry-after": "3" } }),
  });
  const response = await client.request(request);
  assert.equal(response.status, 429);
  assert.equal(response.retryAfterSeconds, 3);
});

test("rejects alternate origins, paths, query parameters, methods, and authorization", async () => {
  const client = new NodeHubSpotCompanyHttpClient({ fetch: async () => new Response("{}") });
  for (const invalid of [
    { ...request, url: new URL("https://example.com/crm/objects/2026-03/companies") },
    { ...request, url: new URL("https://api.hubapi.com/crm/objects/2026-03/contacts") },
    { ...request, url: new URL(`${request.url.toString()}&redirect=https://example.com`) },
    { ...request, method: "POST" },
    { ...request, authorization: "Bearer short" },
  ]) {
    await assert.rejects(() => client.request(invalid as never), /not approved|authorization is invalid/);
  }
});

test("bounds response bytes and rejects malformed JSON", async () => {
  const tooLarge = new NodeHubSpotCompanyHttpClient({
    maximumResponseBytes: 1_024,
    fetch: async () => new Response("x".repeat(1_025), { headers: { "content-length": "1025" } }),
  });
  await assert.rejects(() => tooLarge.request(request), /size limit/);

  const malformed = new NodeHubSpotCompanyHttpClient({ fetch: async () => new Response("not-json") });
  await assert.rejects(() => malformed.request(request), /not valid JSON/);
});

test("turns fetch failures into retryable errors without exposing authorization", async () => {
  const client = new NodeHubSpotCompanyHttpClient({
    fetch: async () => {
      throw new Error(request.authorization);
    },
  });
  await assert.rejects(
    () => client.request(request),
    (error: unknown) =>
      error instanceof PortOperationError && error.retryable && !error.message.includes(request.authorization),
  );
});
