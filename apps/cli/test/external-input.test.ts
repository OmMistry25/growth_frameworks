import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadAccountFile,
  loadCompetitiveFootprintConfig,
  parseAccountFile,
  parseCompetitiveFootprintConfig,
} from "../src/external-input.ts";

const configPath = fileURLToPath(
  new URL("../../../examples/competitive-footprint/config.json", import.meta.url),
);
const accountsPath = fileURLToPath(
  new URL("../../../examples/competitive-footprint/accounts.json", import.meta.url),
);

test("loads the sanitized external configuration example", async () => {
  const config = await loadCompetitiveFootprintConfig(configPath);

  assert.equal(config.schemaVersion, 1);
  assert.equal(config.framework.detectorIds.length, 3);
  assert.equal(config.framework.cadence.length, 15);
  assert.equal(config.dns[0]?.resolver.timeoutMs, 2_000);
});

test("loads and normalizes the sanitized account example", async () => {
  const accountFile = await loadAccountFile(accountsPath);

  assert.equal(accountFile.dataPolicy, "synthetic-only");
  assert.equal(accountFile.accounts[0]?.domain, "example.com");
  assert.deepEqual(accountFile.accounts[0]?.externalReferences, [
    { system: "example", id: "synthetic-1" },
  ]);
});

test("rejects unknown configuration fields", () => {
  assert.throws(
    () =>
      parseCompetitiveFootprintConfig({
        schemaVersion: 1,
        framework: { lossConfirmationCount: 2, cadence: [] },
        detectors: { dns: [], subdomain: [], tcp: [] },
        deployment: "production",
      }),
    /configuration contains unknown fields: deployment/,
  );
});

test("rejects secret-like fields anywhere in external input", () => {
  assert.throws(
    () =>
      parseAccountFile({
        schemaVersion: 1,
        dataPolicy: "user-supplied",
        accounts: [
          {
            id: "account:one",
            displayName: "One",
            domain: "one.example",
            segment: "standard",
            apiToken: "must-not-enter-config",
          },
        ],
      }),
    /forbidden secret-like field: apiToken/,
  );
});

test("rejects duplicate account identities", () => {
  const duplicate = {
    id: "account:duplicate",
    displayName: "Synthetic Duplicate",
    domain: "duplicate.example",
    segment: "standard",
  } as const;

  assert.throws(
    () =>
      parseAccountFile({
        schemaVersion: 1,
        dataPolicy: "synthetic-only",
        accounts: [duplicate, duplicate],
      }),
    /account ids must be unique/,
  );
});

test("rejects incomplete external cadence configuration", async () => {
  const complete = await loadCompetitiveFootprintConfig(configPath);

  assert.throws(
    () =>
      parseCompetitiveFootprintConfig({
        schemaVersion: 1,
        framework: {
          lossConfirmationCount: complete.framework.lossConfirmationCount,
          cadence: complete.framework.cadence.slice(0, 1),
        },
        detectors: { dns: complete.dns, subdomain: complete.subdomain, tcp: complete.tcp },
      }),
    /cadence is missing rules/,
  );
});
