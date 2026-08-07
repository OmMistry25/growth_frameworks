#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import type {
  Clock,
  TransitionDestination,
  TransitionOutbox,
} from "@growth-frameworks/contracts/competitive-footprint";
import { FileSignalStateStore } from "@growth-frameworks/file-state-store";
import {
  dispatchPendingTransitions,
  type TransitionDispatchResult,
} from "@growth-frameworks/runtime";
import { SlackIncomingWebhookDestination } from "@growth-frameworks/slack";

export interface DeliveryOptions {
  readonly statePath: string;
  readonly webhookUrl: string;
  readonly at: string;
  readonly limit: number;
  readonly maxAttempts: number;
  readonly allowNetwork: true;
  readonly allowStateWrite: true;
  readonly allowDelivery: true;
}

export interface DeliveryReport {
  readonly command: "competitive-footprint";
  readonly mode: "delivery-only";
  readonly destination: "slack-incoming-webhook";
  readonly networkAuthorized: true;
  readonly stateWriteAuthorized: true;
  readonly deliveryAuthorized: true;
  readonly status: "succeeded" | "partial_failure";
  readonly result: TransitionDispatchResult;
}

export interface DeliveryDependencyFactory {
  create(options: DeliveryOptions, clock: Clock): {
    readonly outbox: TransitionOutbox;
    readonly destination: TransitionDestination;
  };
}

export async function runDelivery(
  options: DeliveryOptions,
  factory: DeliveryDependencyFactory = new AuthorizedDeliveryDependencyFactory(),
): Promise<DeliveryReport> {
  if (options.allowNetwork !== true) throw new TypeError("Delivery requires explicit network authorization");
  if (options.allowStateWrite !== true) throw new TypeError("Delivery requires explicit state-write authorization");
  if (options.allowDelivery !== true) throw new TypeError("Delivery requires explicit delivery authorization");
  const runAt = new Date(options.at);
  if (Number.isNaN(runAt.getTime()) || runAt.toISOString() !== options.at) {
    throw new TypeError("Delivery time must be a canonical ISO timestamp");
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new TypeError("Delivery limit must be an integer from 1 to 100");
  }
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 10) {
    throw new TypeError("Maximum delivery attempts must be an integer from 1 to 10");
  }
  const clock = { now: () => runAt };
  const dependencies = factory.create(options, clock);
  const result = await dispatchPendingTransitions(
    { runId: `delivery:${options.at}`, startedAt: options.at, dryRun: false },
    { limit: options.limit, maxAttempts: options.maxAttempts },
    { ...dependencies, clock },
  );
  const failed = result.retryableFailures + result.terminalFailures + result.exhausted > 0;
  return {
    command: "competitive-footprint",
    mode: "delivery-only",
    destination: "slack-incoming-webhook",
    networkAuthorized: true,
    stateWriteAuthorized: true,
    deliveryAuthorized: true,
    status: failed ? "partial_failure" : "succeeded",
    result,
  };
}

export function parseDeliveryArgs(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): DeliveryOptions {
  validateArgumentTokens(args);
  requireSingleFlag(args, "--allow-network", "Delivery requires --allow-network");
  requireSingleFlag(args, "--allow-state-write", "Delivery requires --allow-state-write");
  requireSingleFlag(args, "--allow-delivery", "Delivery requires --allow-delivery");
  const webhookUrl = environment.SLACK_WEBHOOK_URL;
  if (webhookUrl === undefined || webhookUrl.trim().length === 0) {
    throw new TypeError("Delivery requires SLACK_WEBHOOK_URL in the environment");
  }
  return {
    statePath: readSingleValue(args, "--state-file"),
    webhookUrl,
    at: readOptionalValue(args, "--at") ?? new Date().toISOString(),
    limit: parseInteger(readOptionalValue(args, "--limit") ?? "25", "--limit"),
    maxAttempts: parseInteger(readOptionalValue(args, "--max-attempts") ?? "3", "--max-attempts"),
    allowNetwork: true,
    allowStateWrite: true,
    allowDelivery: true,
  };
}

export async function main(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
  writeOutput: (value: string) => void = (value) => process.stdout.write(value),
  writeError: (value: string) => void = (value) => process.stderr.write(value),
  execute: (options: DeliveryOptions) => Promise<DeliveryReport> = runDelivery,
): Promise<number> {
  if (args.includes("--help")) {
    writeOutput(
      "Usage: npm run deliver:competitive-footprint -- --state-file FILE --allow-network --allow-state-write --allow-delivery [--limit 25] [--max-attempts 3] [--at ISO_TIMESTAMP] (requires injected SLACK_WEBHOOK_URL)\n",
    );
    return 0;
  }
  try {
    const report = await execute(parseDeliveryArgs(args, environment));
    writeOutput(`${JSON.stringify(report, null, 2)}\n`);
    return report.status === "succeeded" ? 0 : 1;
  } catch (error) {
    writeError(`${error instanceof Error ? error.message : "Transition delivery failed"}\n`);
    return 1;
  }
}

class AuthorizedDeliveryDependencyFactory implements DeliveryDependencyFactory {
  create(options: DeliveryOptions): {
    readonly outbox: TransitionOutbox;
    readonly destination: TransitionDestination;
  } {
    return {
      outbox: new FileSignalStateStore({ path: options.statePath, allowWrite: true }),
      destination: new SlackIncomingWebhookDestination({
        webhookUrl: options.webhookUrl,
        allowDelivery: true,
      }),
    };
  }
}

function validateArgumentTokens(args: readonly string[]): void {
  const booleanFlags = new Set(["--allow-network", "--allow-state-write", "--allow-delivery"]);
  const valueFlags = new Set(["--state-file", "--at", "--limit", "--max-attempts"]);
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (booleanFlags.has(value)) continue;
    if (valueFlags.has(value)) {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--")) throw new TypeError(`${value} requires a value`);
      index += 1;
      continue;
    }
    throw new TypeError(`Unknown argument: ${value}`);
  }
}

function requireSingleFlag(args: readonly string[], flag: string, missingMessage: string): void {
  const count = args.filter((value) => value === flag).length;
  if (count === 0) throw new TypeError(missingMessage);
  if (count !== 1) throw new TypeError(`${flag} must appear once`);
}

function readSingleValue(args: readonly string[], flag: string): string {
  const indexes = args.flatMap((value, index) => (value === flag ? [index] : []));
  if (indexes.length !== 1) throw new TypeError(`${flag} must appear once`);
  return args[indexes[0]! + 1]!;
}

function readOptionalValue(args: readonly string[], flag: string): string | undefined {
  if (!args.includes(flag)) return undefined;
  return readSingleValue(args, flag);
}

function parseInteger(value: string, flag: string): number {
  if (!/^\d+$/.test(value)) throw new TypeError(`${flag} must be an integer`);
  return Number(value);
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  process.exitCode = await main(process.argv.slice(2));
}
