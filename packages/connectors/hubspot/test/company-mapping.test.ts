import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ContractValidationError } from "@growth-frameworks/contracts/competitive-footprint";

import {
  mapHubSpotCompanyToAccount,
  parseHubSpotCompanyPage,
  validateHubSpotCompanyMappingConfig,
  type HubSpotCompanyMappingConfig,
} from "../src/company-mapping.ts";

const config: HubSpotCompanyMappingConfig = {
  properties: { displayName: "name", domain: "domain", segment: "monitoring_tier" },
  segmentValues: { tier_1: "high_priority", tier_2: "standard", tier_3: "low_priority" },
};

test("parses a clearly marked synthetic company page and maps canonical accounts", async () => {
  const fixture = JSON.parse(
    await readFile(new URL("./fixtures/companies-page.synthetic.json", import.meta.url), "utf8"),
  ) as { synthetic: unknown; response: unknown };
  assert.equal(fixture.synthetic, true);

  const page = parseHubSpotCompanyPage(fixture.response);
  assert.equal(page.paging?.next?.after, "100002");
  assert.deepEqual(mapHubSpotCompanyToAccount(page.results[0]!, config), {
    id: "hubspot:company:100001",
    displayName: "Northstar Systems",
    domain: "northstar.example",
    segment: "high_priority",
    externalReferences: [{ system: "hubspot", id: "100001" }],
  });
});

test("keeps provider stage policy in explicit connector configuration", () => {
  const custom = {
    properties: { displayName: "company_label", domain: "web_domain", segment: "custom_stage" },
    segmentValues: { strategic: "high_priority" },
  } as const;
  const account = mapHubSpotCompanyToAccount(
    { id: "company-7", properties: { company_label: "Example", web_domain: "example.com", custom_stage: "strategic" } },
    custom,
  );
  assert.equal(account.segment, "high_priority");
});

test("rejects missing, null, archived, and unmapped company values", () => {
  for (const record of [
    { id: "1", properties: { name: null, domain: "example.com", monitoring_tier: "tier_1" } },
    { id: "1", properties: { name: "Example", domain: null, monitoring_tier: "tier_1" } },
    { id: "1", properties: { name: "Example", domain: "example.com", monitoring_tier: null } },
    { id: "1", properties: { name: "Example", domain: "example.com", monitoring_tier: "unknown" } },
    { id: "1", properties: { name: "Example", domain: "example.com", monitoring_tier: "tier_1" }, archived: true },
  ]) {
    assert.throws(() => mapHubSpotCompanyToAccount(record, config), ContractValidationError);
  }
});

test("rejects malformed provider pages before mapping", () => {
  for (const page of [
    {},
    { results: [{ id: "1", properties: { name: 42 } }] },
    { results: [], paging: { next: { after: "" } } },
    { results: [{ id: "1", properties: {}, archived: "false" }] },
    { results: [{ id: "1", properties: {}, createdAt: "yesterday" }] },
  ]) {
    assert.throws(() => parseHubSpotCompanyPage(page), ContractValidationError);
  }
});

test("rejects unsafe or ambiguous mapping configuration", () => {
  for (const candidate of [
    { ...config, properties: { ...config.properties, domain: "name" } },
    { ...config, properties: { ...config.properties, segment: "access_token" } },
    { ...config, properties: { ...config.properties, displayName: "bad-name" } },
    { ...config, segmentValues: {} },
    { ...config, segmentValues: { " tier_1": "high_priority" } },
    { ...config, segmentValues: { tier_1: "urgent" } },
  ]) {
    assert.throws(() => validateHubSpotCompanyMappingConfig(candidate as never), TypeError);
  }
});
