import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { Account, RunContext } from "@growth-frameworks/contracts/competitive-footprint";

import {
  DnsSignalDetector,
  type DnsDetectorConfig,
  type DnsQuery,
  type DnsResolution,
  type DnsResolverPort,
} from "../src/dns-detector.ts";
import { NodeDnsResolver } from "../src/node-dns-resolver.ts";

interface FixtureCase {
  readonly id: string;
  readonly resolution: DnsResolution;
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

const config: DnsDetectorConfig = {
  id: "detector:dns-vendor",
  rules: [
    {
      hostnameTemplate: "{domain}",
      recordType: "CNAME",
      matcher: { type: "suffix", value: "vendor.example" },
      evidenceCode: "dns_vendor_cname",
      confidence: "high",
    },
  ],
  negativeEvidenceCode: "dns_no_match",
  timeoutEvidenceCode: "dns_timeout",
  negativeConfidence: "medium",
};

const fixtureUrl = new URL("./fixtures/dns-cases.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as FixtureFile;

test("DNS fixture is explicitly synthetic", () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.dataPolicy, "synthetic-only");
  assert.equal(new Set(fixture.cases.map(({ id }) => id)).size, fixture.cases.length);
});

for (const fixtureCase of fixture.cases) {
  test(`DNS fixture: ${fixtureCase.id}`, async () => {
    const resolver = new QueueResolver([fixtureCase.resolution]);
    const detector = new DnsSignalDetector(config, resolver);

    const observation = await detector.observe(account, context);

    assert.equal(observation.status, fixtureCase.expected.status);
    assert.equal(observation.confidence, fixtureCase.expected.confidence);
    assert.deepEqual(observation.evidenceCodes, fixtureCase.expected.evidenceCodes);
    assert.deepEqual(resolver.queries, [{ hostname: "example.com", recordType: "CNAME" }]);
    assert.match(observation.fingerprint, /^[a-f0-9]{64}$/);
  });
}

test("a positive answer wins when another DNS rule times out", async () => {
  const resolver = new QueueResolver([
    { status: "timeout" },
    { status: "answered", values: ["verification=synthetic-token"] },
  ]);
  const detector = new DnsSignalDetector(
    {
      ...config,
      rules: [
        config.rules[0]!,
        {
          hostnameTemplate: "_verify.{domain}",
          recordType: "TXT",
          matcher: { type: "contains", value: "verification=" },
          evidenceCode: "dns_vendor_txt",
          confidence: "medium",
        },
      ],
    },
    resolver,
  );

  const observation = await detector.observe(account, context);

  assert.equal(observation.status, "positive");
  assert.equal(observation.confidence, "medium");
  assert.deepEqual(observation.evidenceCodes, ["dns_vendor_txt"]);
  assert.deepEqual(resolver.queries[1], { hostname: "_verify.example.com", recordType: "TXT" });
});

test("rejects fixed company hostnames in detector configuration", () => {
  assert.throws(
    () =>
      new DnsSignalDetector(
        {
          ...config,
          rules: [{ ...config.rules[0]!, hostnameTemplate: "customer.example.com" }],
        },
        new QueueResolver([]),
      ),
    /hostname template is invalid/,
  );
});

test("validates matcher and confidence values at runtime", () => {
  assert.throws(
    () =>
      new DnsSignalDetector(
        {
          ...config,
          negativeConfidence: "invalid" as DnsDetectorConfig["negativeConfidence"],
          rules: [
            {
              ...config.rules[0]!,
              matcher: { type: "invalid" as "exact", value: "vendor.example" },
            },
          ],
        },
        new QueueResolver([]),
      ),
    /negative confidence is invalid; DNS rule 0 matcher type is invalid/,
  );
});

test("Node resolver enforces bounded timeout and retry configuration", () => {
  assert.throws(() => new NodeDnsResolver({ timeoutMs: 99, tries: 1 }), /DNS timeout/);
  assert.throws(() => new NodeDnsResolver({ timeoutMs: 1_000, tries: 6 }), /DNS tries/);
  assert.doesNotThrow(() => new NodeDnsResolver({ timeoutMs: 1_000, tries: 2 }));
});

class QueueResolver implements DnsResolverPort {
  readonly queries: DnsQuery[] = [];
  readonly #resolutions: DnsResolution[];

  constructor(resolutions: DnsResolution[]) {
    this.#resolutions = [...resolutions];
  }

  async resolve(query: DnsQuery): Promise<DnsResolution> {
    this.queries.push(query);
    const resolution = this.#resolutions.shift();
    if (resolution === undefined) throw new Error("Synthetic resolver queue is empty");
    return resolution;
  }
}
