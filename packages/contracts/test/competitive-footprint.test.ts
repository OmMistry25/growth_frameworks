import assert from "node:assert/strict";
import test from "node:test";

import {
  ContractValidationError,
  normalizeDomain,
  PortOperationError,
  validateAccount,
  validateConfig,
  validateObservation,
} from "../src/competitive-footprint.ts";

test("normalizes a URL to its lowercase hostname", () => {
  assert.equal(normalizeDomain(" HTTPS://WWW.Example.COM./path?q=1 "), "example.com");
});

test("preserves a supplied subdomain", () => {
  assert.equal(normalizeDomain("status.example.com"), "status.example.com");
});

test("rejects non-public hostname forms", () => {
  for (const value of ["localhost", "127.0.0.1", "https://[::1]"]) {
    assert.throws(() => normalizeDomain(value), ContractValidationError);
  }
});

test("validates and returns a normalized account", () => {
  const account = validateAccount({
    id: "account:synthetic-1",
    displayName: " Synthetic Account ",
    domain: "WWW.EXAMPLE.COM",
    segment: "standard",
  });

  assert.deepEqual(account, {
    id: "account:synthetic-1",
    displayName: "Synthetic Account",
    domain: "example.com",
    segment: "standard",
  });
});

test("rejects unsafe observation evidence codes", () => {
  assert.throws(
    () =>
      validateObservation({
        accountId: "account:synthetic-1",
        detectorId: "detector:dns",
        detectorKind: "dns",
        observedAt: "2026-08-07T12:00:00.000Z",
        status: "positive",
        confidence: "high",
        evidenceCodes: ["raw provider payload"],
        fingerprint: "observation:1",
      }),
    /evidence code is invalid/,
  );
});

test("requires unique detectors and cadence rules", () => {
  assert.throws(
    () =>
      validateConfig({
        detectorIds: ["detector:dns", "detector:dns"],
        cadence: [
          { segment: "standard", state: "unknown", intervalHours: 24 },
          { segment: "standard", state: "unknown", intervalHours: 48 },
        ],
        lossConfirmationCount: 2,
      }),
    /detector ids must be unique; cadence rules must be unique/,
  );
});

test("port errors accept only sanitized failure codes", () => {
  const error = new PortOperationError("safe message", "transient", true, {
    failureCode: "hostname_resolution_failed",
  });
  assert.equal(error.failureCode, "hostname_resolution_failed");
  assert.throws(
    () => new PortOperationError("safe message", "transient", true, { failureCode: "Host: private.example" }),
    /failure code is invalid/,
  );
});
