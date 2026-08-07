import assert from "node:assert/strict";
import test from "node:test";

import { parseHubSpotSourceConfig } from "../src/hubspot-input.ts";

const valid = {
  schemaVersion: 1,
  mapping: {
    properties: { displayName: "name", domain: "domain", segment: "monitoring_tier" },
    segmentValues: { tier_1: "high_priority", tier_2: "standard", tier_3: "low_priority" },
  },
  request: { pageSize: 100, maxPages: 10, timeoutMs: 5_000 },
  retry: { maxAttempts: 3, baseDelayMs: 250, maximumDelayMs: 5_000 },
};

test("loads only non-secret HubSpot source policy", () => {
  assert.deepEqual(parseHubSpotSourceConfig(valid), valid);
});

test("rejects secrets, unknown fields, and unsafe bounds", () => {
  for (const input of [
    { ...valid, accessToken: "must-not-be-here" },
    { ...valid, extra: true },
    { ...valid, request: { ...valid.request, pageSize: 101 } },
    { ...valid, retry: { ...valid.retry, maxAttempts: 6 } },
  ]) {
    assert.throws(() => parseHubSpotSourceConfig(input), /forbidden secret-like|unknown fields|integer/);
  }
});
