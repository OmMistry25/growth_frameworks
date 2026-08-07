import assert from "node:assert/strict";
import test from "node:test";

import type {
  RunContext,
  SignalTransition,
} from "@growth-frameworks/contracts/competitive-footprint";

import {
  SlackIncomingWebhookDestination,
  type SlackWebhookHttpPort,
  type SlackWebhookResponse,
} from "../src/incoming-webhook-destination.ts";

const webhookUrl = "https://hooks.slack.com/services/T00000000/B00000000/secret_token_value";
const context: RunContext = {
  runId: "run:synthetic-1",
  startedAt: "2026-08-07T12:00:00.000Z",
  dryRun: false,
};
const transition: SignalTransition = {
  idempotencyKey: "transition:synthetic-1",
  kind: "detected",
  accountId: "account:synthetic-1",
  detectorId: "detector:dns",
  occurredAt: "2026-08-07T12:00:00.000Z",
  previous: {
    accountId: "account:synthetic-1",
    detectorId: "detector:dns",
    state: "unknown",
    confidence: null,
    lastCheckedAt: null,
    lastConclusiveObservationAt: null,
    evidenceCodes: [],
    version: 0,
  },
  next: {
    accountId: "account:synthetic-1",
    detectorId: "detector:dns",
    state: "confirmed",
    confidence: "high",
    lastCheckedAt: "2026-08-07T12:00:00.000Z",
    lastConclusiveObservationAt: "2026-08-07T12:00:00.000Z",
    evidenceCodes: ["dns_match"],
    version: 1,
  },
};

test("requires explicit delivery authorization and an approved endpoint", () => {
  assert.throws(
    () => new SlackIncomingWebhookDestination({ webhookUrl, allowDelivery: false } as never),
    /explicit authorization/,
  );
  for (const invalid of [
    "http://hooks.slack.com/services/T00000000/B00000000/secret_token_value",
    "https://example.com/services/T00000000/B00000000/secret_token_value",
    "https://hooks.slack.com/services/short/path/value",
    "https://hooks.slack.com/services/T00000000/B00000000/secret_token_value?leak=true",
  ]) {
    assert.throws(
      () => new SlackIncomingWebhookDestination({ webhookUrl: invalid, allowDelivery: true }),
      /approved incoming-webhook endpoint/,
    );
  }
});

test("posts a bounded transition message without account domains", async () => {
  const http = new RecordingHttp({ status: 200, body: "ok" });
  const destination = new SlackIncomingWebhookDestination({ webhookUrl, allowDelivery: true, http });
  await destination.deliver(transition, context);
  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0]?.timeoutMs, 5_000);
  assert.match(http.calls[0]?.text ?? "", /Account: account:synthetic-1/);
  assert.match(http.calls[0]?.text ?? "", /State: unknown -> confirmed/);
  assert.doesNotMatch(http.calls[0]?.text ?? "", /example\.com/);
});

test("refuses delivery from a dry-run context", async () => {
  const http = new RecordingHttp({ status: 200, body: "ok" });
  const destination = new SlackIncomingWebhookDestination({ webhookUrl, allowDelivery: true, http });
  await assert.rejects(() => destination.deliver(transition, { ...context, dryRun: true }), /disabled during dry run/);
  assert.equal(http.calls.length, 0);
});

test("bounds fields and escapes Slack control syntax", async () => {
  const http = new RecordingHttp({ status: 200, body: "ok" });
  const destination = new SlackIncomingWebhookDestination({ webhookUrl, allowDelivery: true, http });
  await destination.deliver({ ...transition, accountId: "account:<synthetic>" }, context);
  assert.match(http.calls[0]?.text ?? "", /account:&lt;synthetic&gt;/);
  assert.doesNotMatch(http.calls[0]?.text ?? "", /<synthetic>/);

  await assert.rejects(
    () => destination.deliver({ ...transition, idempotencyKey: "x".repeat(257) }, context),
    /idempotency key is invalid/,
  );
  assert.equal(http.calls.length, 1);
});

test("categorizes rate limits, server failures, and rejected payloads", async () => {
  for (const testCase of [
    { response: { status: 429, body: "rate_limited", retryAfterSeconds: 2 }, category: "rate_limited", retryable: true },
    { response: { status: 503, body: "rollup_error" }, category: "transient", retryable: true },
    { response: { status: 403, body: "action_prohibited" }, category: "permanent", retryable: false },
    { response: { status: 200, body: "unexpected" }, category: "permanent", retryable: false },
  ] as const) {
    const destination = new SlackIncomingWebhookDestination({
      webhookUrl,
      allowDelivery: true,
      http: new RecordingHttp(testCase.response),
    });
    await assert.rejects(
      () => destination.deliver(transition, context),
      (error: unknown) =>
        error instanceof Error &&
        "category" in error &&
        error.category === testCase.category &&
        "retryable" in error &&
        error.retryable === testCase.retryable,
    );
  }
});

test("never includes the webhook secret in errors", async () => {
  const destination = new SlackIncomingWebhookDestination({
    webhookUrl,
    allowDelivery: true,
    http: new RecordingHttp({ status: 404, body: "no_service" }),
  });
  await assert.rejects(
    () => destination.deliver(transition, context),
    (error: unknown) => error instanceof Error && !error.message.includes("secret_token_value"),
  );
});

class RecordingHttp implements SlackWebhookHttpPort {
  readonly calls: Array<{ readonly url: URL; readonly text: string; readonly timeoutMs: number }> = [];
  readonly #response: SlackWebhookResponse;

  constructor(response: SlackWebhookResponse) {
    this.#response = response;
  }

  async post(url: URL, payload: Readonly<{ text: string }>, timeoutMs: number): Promise<SlackWebhookResponse> {
    this.calls.push({ url, text: payload.text, timeoutMs });
    return this.#response;
  }
}
