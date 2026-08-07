import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { Account, RunContext } from "@growth-frameworks/contracts/competitive-footprint";

import { NodeHttpProbeClient } from "../src/node-http-probe-client.ts";
import { isPublicAddress } from "../src/public-address.ts";
import {
  SubdomainSignalDetector,
  type HttpProbeClientPort,
  type HttpProbeRequest,
  type HttpProbeResult,
  type SubdomainDetectorConfig,
} from "../src/subdomain-detector.ts";

interface FixtureCase {
  readonly id: string;
  readonly result: HttpProbeResult;
  readonly expected: {
    readonly status: "positive" | "negative" | "indeterminate";
    readonly confidence: "low" | "medium" | "high";
    readonly evidenceCodes: readonly string[];
  };
}

interface FixtureFile {
  readonly schemaVersion: number;
  readonly dataPolicy: string;
  readonly cases: readonly FixtureCase[];
}

const account: Account = {
  id: "account:synthetic-1",
  displayName: "Synthetic Account",
  domain: "example.com",
  segment: "standard",
};

const context: RunContext = {
  runId: "run:synthetic-1",
  startedAt: "2026-08-07T12:00:00.000Z",
  dryRun: false,
};

const config: SubdomainDetectorConfig = {
  id: "detector:subdomain",
  rules: [
    {
      hostnameTemplate: "portal.{domain}",
      protocol: "https",
      path: "/health",
      acceptedStatusCodes: [200, 204],
      evidenceCode: "subdomain_responsive",
      confidence: "high",
    },
  ],
  timeoutMs: 2_000,
  maxRedirects: 2,
  maxResponseBytes: 1_024,
  negativeEvidenceCode: "subdomain_unresponsive",
  timeoutEvidenceCode: "subdomain_timeout",
  negativeConfidence: "medium",
};

const fixtureUrl = new URL("./fixtures/subdomain-cases.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as FixtureFile;

test("subdomain fixture is explicitly synthetic", () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.dataPolicy, "synthetic-only");
});

for (const fixtureCase of fixture.cases) {
  test(`subdomain fixture: ${fixtureCase.id}`, async () => {
    const client = new QueueHttpClient([fixtureCase.result]);
    const detector = new SubdomainSignalDetector(config, client);

    const observation = await detector.observe(account, context);

    assert.equal(observation.status, fixtureCase.expected.status);
    assert.equal(observation.confidence, fixtureCase.expected.confidence);
    assert.deepEqual(observation.evidenceCodes, fixtureCase.expected.evidenceCodes);
    assert.equal(client.requests[0]?.url, "https://portal.example.com/health");
    assert.match(observation.fingerprint, /^[a-f0-9]{64}$/);
  });
}

test("rejects fixed hostnames and unsafe request bounds", () => {
  assert.throws(
    () =>
      new SubdomainSignalDetector(
        {
          ...config,
          timeoutMs: 50,
          rules: [{ ...config.rules[0]!, hostnameTemplate: "portal.customer.example" }],
        },
        new QueueHttpClient([]),
      ),
    /subdomain timeout is invalid; subdomain rule 0 hostname template is invalid/,
  );
});

test("public address policy blocks local, private, documentation, and mapped addresses", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.1.1",
    "192.0.2.10",
    "::1",
    "fe80::1",
    "2001:db8::1",
    "::ffff:8.8.8.8",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  assert.equal(isPublicAddress("not-an-address"), false);
});

test("Node HTTP client validates bounds before resolving a hostname", async () => {
  let resolverCalls = 0;
  const client = new NodeHttpProbeClient({
    async resolve() {
      resolverCalls += 1;
      return [];
    },
  });

  await assert.rejects(
    () =>
      client.probe({
        url: "https://probe.synthetic/",
        timeoutMs: 50,
        maxRedirects: 1,
        maxResponseBytes: 128,
      }),
    /HTTP probe timeout/,
  );
  assert.equal(resolverCalls, 0);
});

class QueueHttpClient implements HttpProbeClientPort {
  readonly requests: HttpProbeRequest[] = [];
  readonly #results: HttpProbeResult[];

  constructor(results: HttpProbeResult[]) {
    this.#results = [...results];
  }

  async probe(request: HttpProbeRequest): Promise<HttpProbeResult> {
    this.requests.push(request);
    const result = this.#results.shift();
    if (result === undefined) throw new Error("Synthetic HTTP result queue is empty");
    return result;
  }
}
