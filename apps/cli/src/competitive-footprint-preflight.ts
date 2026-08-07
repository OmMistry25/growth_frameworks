#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  FileSignalStateStore,
  type FileOutboxSummary,
} from "@growth-frameworks/file-state-store";

export interface PreflightOptions {
  readonly statePath: string;
  readonly maxAttempts: number;
}

export interface PreflightReport {
  readonly command: "competitive-footprint";
  readonly mode: "outbox-preflight";
  readonly readOnly: true;
  readonly status: "ready" | "empty" | "attention";
  readonly outbox: FileOutboxSummary;
}

export async function runPreflight(options: PreflightOptions): Promise<PreflightReport> {
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 10) {
    throw new TypeError("Maximum delivery attempts must be an integer from 1 to 10");
  }
  const outbox = await new FileSignalStateStore({
    path: options.statePath,
    readOnly: true,
  }).inspectOutbox(options.maxAttempts);
  return {
    command: "competitive-footprint",
    mode: "outbox-preflight",
    readOnly: true,
    status:
      outbox.sourceSchemaVersion === 1 || outbox.exhausted > 0
        ? "attention"
        : outbox.deliverable > 0
          ? "ready"
          : "empty",
    outbox,
  };
}

export function parsePreflightArgs(args: readonly string[]): PreflightOptions {
  validateArgumentTokens(args);
  return {
    statePath: readSingleValue(args, "--state-file"),
    maxAttempts: parseInteger(readOptionalValue(args, "--max-attempts") ?? "3", "--max-attempts"),
  };
}

export async function main(
  args: readonly string[],
  writeOutput: (value: string) => void = (value) => process.stdout.write(value),
  writeError: (value: string) => void = (value) => process.stderr.write(value),
  execute: (options: PreflightOptions) => Promise<PreflightReport> = runPreflight,
): Promise<number> {
  if (args.includes("--help")) {
    writeOutput(
      "Usage: npm run preflight:competitive-footprint -- --state-file FILE [--max-attempts 3]\n",
    );
    return 0;
  }
  try {
    const report = await execute(parsePreflightArgs(args));
    writeOutput(`${JSON.stringify(report, null, 2)}\n`);
    return report.status === "attention" ? 1 : 0;
  } catch (error) {
    writeError(`${error instanceof Error ? error.message : "Outbox preflight failed"}\n`);
    return 1;
  }
}

function validateArgumentTokens(args: readonly string[]): void {
  const valueFlags = new Set(["--state-file", "--max-attempts"]);
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (valueFlags.has(value)) {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--")) throw new TypeError(`${value} requires a value`);
      index += 1;
      continue;
    }
    throw new TypeError(`Unknown argument: ${value}`);
  }
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
