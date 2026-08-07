import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { Account, RunContext } from "@growth-frameworks/contracts/competitive-footprint";

import { NodeTcpProbeClient } from "../src/node-tcp-probe-client.ts";
import {
  TcpSignalDetector,
  type TcpDetectorConfig,
  type TcpProbeClientPort,
  type TcpProbeRequest,
  type TcpProbeResult,
} from "../src/tcp-detector.ts";

interface FixtureCase {
  readonly id: string;
  readonly result: TcpProbeResult;
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

const config: TcpDetectorConfig = {
  id: "detector:tcp-service",
  rules: [
    {
      hostnameTemplate: "service.{domain}",
      port: 443,
      tls: true,
      evidenceCode: "tcp_service_connected",
      confidence: "high",
    },
  ],
  timeoutMs: 2_000,
  negativeEvidenceCode: "tcp_service_unavailable",
  timeoutEvidenceCode: "tcp_timeout",
  negativeConfidence: "medium",
};

const fixtureUrl = new URL("./fixtures/tcp-cases.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as FixtureFile;

test("TCP fixture is explicitly synthetic", () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.dataPolicy, "synthetic-only");
});

for (const fixtureCase of fixture.cases) {
  test(`TCP fixture: ${fixtureCase.id}`, async () => {
    const client = new QueueTcpClient([fixtureCase.result]);
    const detector = new TcpSignalDetector(config, client);

    const observation = await detector.observe(account, context);

    assert.equal(observation.status, fixtureCase.expected.status);
    assert.equal(observation.confidence, fixtureCase.expected.confidence);
    assert.deepEqual(observation.evidenceCodes, fixtureCase.expected.evidenceCodes);
    assert.deepEqual(client.requests, [
      { hostname: "service.example.com", port: 443, tls: true, timeoutMs: 2_000 },
    ]);
    assert.match(observation.fingerprint, /^[a-f0-9]{64}$/);
  });
}

test("connected rule wins when another TCP rule times out", async () => {
  const client = new QueueTcpClient([
    { status: "timeout" },
    { status: "connected", family: 6 },
  ]);
  const detector = new TcpSignalDetector(
    {
      ...config,
      rules: [
        config.rules[0]!,
        {
          hostnameTemplate: "gateway.{domain}",
          port: 8443,
          tls: true,
          evidenceCode: "tcp_gateway_connected",
          confidence: "medium",
        },
      ],
    },
    client,
  );

  const observation = await detector.observe(account, context);

  assert.equal(observation.status, "positive");
  assert.equal(observation.confidence, "medium");
  assert.deepEqual(observation.evidenceCodes, ["tcp_gateway_connected"]);
});

test("rejects fixed hostnames, invalid ports, and unsafe timeouts", () => {
  assert.throws(
    () =>
      new TcpSignalDetector(
        {
          ...config,
          timeoutMs: 50,
          rules: [{ ...config.rules[0]!, hostnameTemplate: "service.customer.example", port: 0 }],
        },
        new QueueTcpClient([]),
      ),
    /TCP timeout is invalid; TCP rule 0 hostname template is invalid; TCP rule 0 port is invalid/,
  );
});

test("Node TCP client validates bounds before resolving a hostname", async () => {
  let resolverCalls = 0;
  const client = new NodeTcpProbeClient({
    async resolve() {
      resolverCalls += 1;
      return [];
    },
  });

  await assert.rejects(
    () => client.probe({ hostname: "service.synthetic", port: 0, tls: false, timeoutMs: 1_000 }),
    /TCP probe port/,
  );
  assert.equal(resolverCalls, 0);
});

class QueueTcpClient implements TcpProbeClientPort {
  readonly requests: TcpProbeRequest[] = [];
  readonly #results: TcpProbeResult[];

  constructor(results: TcpProbeResult[]) {
    this.#results = [...results];
  }

  async probe(request: TcpProbeRequest): Promise<TcpProbeResult> {
    this.requests.push(request);
    const result = this.#results.shift();
    if (result === undefined) throw new Error("Synthetic TCP result queue is empty");
    return result;
  }
}
