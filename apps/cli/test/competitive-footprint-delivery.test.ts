import assert from "node:assert/strict";
import test from "node:test";

import type {
  Clock,
  TransitionDestination,
  TransitionOutbox,
} from "@growth-frameworks/contracts/competitive-footprint";

import {
  main,
  parseDeliveryArgs,
  runDelivery,
  type DeliveryDependencyFactory,
  type DeliveryOptions,
} from "../src/competitive-footprint-delivery.ts";

const webhookUrl = "https://hooks.slack.com/services/T00000000/B00000000/secret_token_value";
const requiredArgs = [
  "--state-file", "state.json",
  "--allow-network",
  "--allow-state-write",
  "--allow-delivery",
  "--at", "2026-08-07T12:00:00.000Z",
] as const;

test("parser requires all authorization gates, state file, and environment secret", () => {
  for (const flag of ["--allow-network", "--allow-state-write", "--allow-delivery"]) {
    assert.throws(
      () => parseDeliveryArgs(requiredArgs.filter((value) => value !== flag), { SLACK_WEBHOOK_URL: webhookUrl }),
      /requires --allow/,
    );
  }
  assert.throws(() => parseDeliveryArgs(requiredArgs, {}), /requires SLACK_WEBHOOK_URL/);
  assert.throws(
    () => parseDeliveryArgs(requiredArgs.filter((value) => value !== "state.json" && value !== "--state-file"), { SLACK_WEBHOOK_URL: webhookUrl }),
    /--state-file must appear once/,
  );
});

test("parser rejects webhook arguments, duplicates, and invalid numeric input", () => {
  assert.throws(
    () => parseDeliveryArgs([...requiredArgs, "--webhook-url", webhookUrl], { SLACK_WEBHOOK_URL: webhookUrl }),
    /Unknown argument: --webhook-url/,
  );
  assert.throws(
    () => parseDeliveryArgs([...requiredArgs, "--allow-delivery"], { SLACK_WEBHOOK_URL: webhookUrl }),
    /--allow-delivery must appear once/,
  );
  assert.throws(
    () => parseDeliveryArgs([...requiredArgs, "--limit", "1.5"], { SLACK_WEBHOOK_URL: webhookUrl }),
    /--limit must be an integer/,
  );
});

test("delivery runner composes one destination and returns an aggregate report", async () => {
  const factory = new SyntheticFactory();
  const report = await runDelivery(options(), factory);
  assert.equal(factory.created, 1);
  assert.equal(report.mode, "delivery-only");
  assert.equal(report.destination, "slack-incoming-webhook");
  assert.equal(report.status, "succeeded");
  assert.deepEqual(report.result, {
    selected: 0,
    delivered: 0,
    retryableFailures: 0,
    terminalFailures: 0,
    exhausted: 0,
    skipped: 0,
    failures: [],
  });
  assert.equal(JSON.stringify(report).includes("secret_token_value"), false);
});

test("CLI refuses missing authorization before invoking its runner", async () => {
  let executed = false;
  let error = "";
  const exitCode = await main(
    requiredArgs.filter((value) => value !== "--allow-delivery"),
    { SLACK_WEBHOOK_URL: webhookUrl },
    () => undefined,
    (value) => { error += value; },
    async () => {
      executed = true;
      throw new Error("runner must not execute");
    },
  );
  assert.equal(exitCode, 1);
  assert.equal(executed, false);
  assert.equal(error, "Delivery requires --allow-delivery\n");
});

function options(): DeliveryOptions {
  return {
    statePath: "state.json",
    webhookUrl,
    at: "2026-08-07T12:00:00.000Z",
    limit: 25,
    maxAttempts: 3,
    allowNetwork: true,
    allowStateWrite: true,
    allowDelivery: true,
  };
}

class SyntheticFactory implements DeliveryDependencyFactory {
  created = 0;

  create(_options: DeliveryOptions, _clock: Clock): {
    readonly outbox: TransitionOutbox;
    readonly destination: TransitionDestination;
  } {
    this.created += 1;
    return {
      outbox: {
        async listPending() { return []; },
        async recordAttempt() { return "missing"; },
        async markDelivered() { return "missing"; },
      },
      destination: { async deliver() { throw new Error("no item should be delivered"); } },
    };
  }
}
