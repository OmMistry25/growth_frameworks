import assert from "node:assert/strict";
import test from "node:test";

import type { RunContext } from "@growth-frameworks/contracts/competitive-footprint";
import type { HubSpotCompanyHttpPort, HubSpotCompanyHttpRequest } from "../src/company-account-source.ts";
import { HubSpotSingleCompanyAccountSource } from "../src/single-company-account-source.ts";

const context: RunContext = { runId: "run:canary", startedAt: "2026-08-07T12:00:00.000Z", dryRun: true };
const companyId = "336132462329";

test("reads exactly one allowlisted company and assigns a local segment", async () => {
  const http = new RecordingPort({
    status: 200,
    body: { id: companyId, properties: { name: "Authorized Company", domain: "www.console.com" }, archived: false },
  });
  const source = new HubSpotSingleCompanyAccountSource({
    accessToken: "synthetic-token-do-not-use",
    companyId,
    expectedDomain: "console.com",
    segment: "standard",
    http,
  });
  const accounts = await collect(source.listAccounts(context));
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0]?.domain, "console.com");
  assert.equal(accounts[0]?.segment, "standard");
  assert.equal(http.requests.length, 1);
  assert.equal(http.requests[0]?.url.pathname, `/crm/objects/2026-03/companies/${companyId}`);
  assert.equal(http.requests[0]?.url.searchParams.get("properties"), "name,domain");
});

test("fails closed before yielding on ID or domain mismatch", async () => {
  for (const body of [
    { id: "999", properties: { name: "Wrong ID", domain: "console.com" } },
    { id: companyId, properties: { name: "Wrong domain", domain: "example.com" } },
  ]) {
    const source = new HubSpotSingleCompanyAccountSource({
      accessToken: "synthetic-token-do-not-use",
      companyId,
      expectedDomain: "console.com",
      segment: "standard",
      http: new RecordingPort({ status: 200, body }),
    });
    await assert.rejects(() => collect(source.listAccounts(context)), /did not match the allowlist/);
  }
});

test("rejects non-numeric IDs, archived records, and missing properties", async () => {
  assert.throws(
    () => new HubSpotSingleCompanyAccountSource({
      accessToken: "synthetic-token-do-not-use",
      companyId: "all",
      expectedDomain: "console.com",
      segment: "standard",
      http: new RecordingPort({ status: 200, body: {} }),
    }),
    /must be numeric/,
  );
  for (const body of [
    { id: companyId, properties: { name: "Archived", domain: "console.com" }, archived: true },
    { id: companyId, properties: { name: null, domain: "console.com" } },
  ]) {
    const source = new HubSpotSingleCompanyAccountSource({
      accessToken: "synthetic-token-do-not-use",
      companyId,
      expectedDomain: "console.com",
      segment: "standard",
      http: new RecordingPort({ status: 200, body }),
    });
    await assert.rejects(() => collect(source.listAccounts(context)));
  }
});

class RecordingPort implements HubSpotCompanyHttpPort {
  readonly requests: HubSpotCompanyHttpRequest[] = [];
  readonly #response: { readonly status: number; readonly body: unknown };
  constructor(response: { readonly status: number; readonly body: unknown }) { this.#response = response; }
  async request(input: HubSpotCompanyHttpRequest) { this.requests.push(input); return this.#response; }
}

async function collect<T>(input: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of input) values.push(value);
  return values;
}
