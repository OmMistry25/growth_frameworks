#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  validateRunRecord,
  type RunRecord,
  type RunRecordCounts,
  type RunRecordFailureCategories,
} from "@growth-frameworks/contracts/competitive-footprint";
import { FileSignalStateStore, type FileOutboxSummary } from "@growth-frameworks/file-state-store";

const maximumRecordBytes = 65_536;

export interface PilotEvidenceOptions {
  readonly statePath: string;
  readonly runRecordDirectory: string;
  readonly backupDirectory: string;
  readonly expectedWindows: number;
  readonly maxAttempts: number;
  readonly pilotEvidence: true;
}

export interface PilotEvidenceReport {
  readonly command: "competitive-footprint";
  readonly mode: "monitoring-only-pilot-evidence";
  readonly status: "in_progress" | "ready_for_review" | "attention";
  readonly readOnly: true;
  readonly networkEnabled: false;
  readonly crmAccessEnabled: false;
  readonly stateWriteEnabled: false;
  readonly deliveryEnabled: false;
  readonly windows: {
    readonly expected: number;
    readonly completed: number;
    readonly remaining: number;
  };
  readonly totals: RunRecordCounts;
  readonly failureCategories: RunRecordFailureCategories;
  readonly backups: {
    readonly verified: number;
    readonly complete: boolean;
  };
  readonly outbox: FileOutboxSummary;
  readonly controls: {
    readonly allRunsSucceeded: boolean;
    readonly runRecordsComplete: boolean;
    readonly backupsComplete: boolean;
    readonly pendingTransitionsNeverAttempted: boolean;
    readonly zeroDeliveryAttempts: boolean;
    readonly zeroDeliveries: boolean;
    readonly zeroExhaustedTransitions: boolean;
  };
}

export async function compilePilotEvidence(options: PilotEvidenceOptions): Promise<PilotEvidenceReport> {
  if (options.pilotEvidence !== true) throw new TypeError("Pilot evidence compilation requires its explicit mode gate");
  if (!Number.isInteger(options.expectedWindows) || options.expectedWindows < 1 || options.expectedWindows > 31) {
    throw new TypeError("Expected windows must be an integer from 1 to 31");
  }
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 10) {
    throw new TypeError("Maximum delivery attempts must be an integer from 1 to 10");
  }
  const paths = [options.statePath, options.runRecordDirectory, options.backupDirectory];
  if (paths.some((path) => !isAbsolute(path))) throw new TypeError("Pilot evidence paths must be absolute");
  if (new Set(paths.map((path) => resolve(path))).size !== paths.length) {
    throw new TypeError("Pilot evidence paths must be distinct");
  }

  await assertSecureRegularFile(options.statePath, "Pilot state file");
  const records = await readRunRecords(options.runRecordDirectory);
  const outbox = await new FileSignalStateStore({ path: options.statePath, readOnly: true }).inspectOutbox(options.maxAttempts);
  const verifiedBackups = await inspectBackups(options.backupDirectory, new Set(records.map(({ serialized }) => serialized)));
  const totals = sumCounts(records.map(({ record }) => record.counts));
  const failureCategories = sumFailureCategories(records.map(({ record }) => record.failureCategories));
  const completed = records.length;
  const controls = {
    allRunsSucceeded: records.every(({ record }) => record.status === "succeeded"),
    runRecordsComplete: completed >= options.expectedWindows,
    backupsComplete: verifiedBackups === completed,
    pendingTransitionsNeverAttempted: outbox.pending === outbox.neverAttempted,
    zeroDeliveryAttempts: outbox.attemptedPending === 0 && outbox.pending === outbox.neverAttempted,
    zeroDeliveries: outbox.delivered === 0,
    zeroExhaustedTransitions: outbox.exhausted === 0,
  } as const;
  const safetyControlsPass = controls.allRunsSucceeded && controls.backupsComplete &&
    controls.pendingTransitionsNeverAttempted && controls.zeroDeliveryAttempts &&
    controls.zeroDeliveries && controls.zeroExhaustedTransitions && totals.failed === 0;
  const status = !safetyControlsPass
    ? "attention"
    : controls.runRecordsComplete
      ? "ready_for_review"
      : "in_progress";

  return {
    command: "competitive-footprint",
    mode: "monitoring-only-pilot-evidence",
    status,
    readOnly: true,
    networkEnabled: false,
    crmAccessEnabled: false,
    stateWriteEnabled: false,
    deliveryEnabled: false,
    windows: {
      expected: options.expectedWindows,
      completed,
      remaining: Math.max(0, options.expectedWindows - completed),
    },
    totals,
    failureCategories,
    backups: { verified: verifiedBackups, complete: controls.backupsComplete },
    outbox,
    controls,
  };
}

export function parsePilotEvidenceArgs(args: readonly string[]): PilotEvidenceOptions {
  const gate = "--pilot-evidence";
  const valueFlags = ["--state-file", "--run-record-dir", "--backup-dir", "--expected-windows", "--max-attempts"] as const;
  const allowed = new Set<string>([gate, ...valueFlags]);
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (!allowed.has(value)) throw new TypeError(`Unknown argument: ${value}`);
    if (value === gate) continue;
    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) throw new TypeError(`${value} requires a value`);
    index += 1;
  }
  if (args.filter((value) => value === gate).length !== 1) {
    throw new TypeError("Pilot evidence compilation requires --pilot-evidence exactly once");
  }
  return {
    statePath: readSingleValue(args, "--state-file"),
    runRecordDirectory: readSingleValue(args, "--run-record-dir"),
    backupDirectory: readSingleValue(args, "--backup-dir"),
    expectedWindows: parseInteger(readOptionalValue(args, "--expected-windows") ?? "5", "--expected-windows"),
    maxAttempts: parseInteger(readOptionalValue(args, "--max-attempts") ?? "3", "--max-attempts"),
    pilotEvidence: true,
  };
}

export async function main(
  args: readonly string[],
  writeOutput: (value: string) => void = (value) => process.stdout.write(value),
  writeError: (value: string) => void = (value) => process.stderr.write(value),
  execute: (options: PilotEvidenceOptions) => Promise<PilotEvidenceReport> = compilePilotEvidence,
): Promise<number> {
  if (args.includes("--help")) {
    writeOutput("Usage: npm run evidence:competitive-footprint:pilot -- --pilot-evidence --state-file FILE --run-record-dir DIRECTORY --backup-dir DIRECTORY [--expected-windows 5] [--max-attempts 3]\n");
    return 0;
  }
  try {
    const report = await execute(parsePilotEvidenceArgs(args));
    writeOutput(`${JSON.stringify(report, null, 2)}\n`);
    return report.status === "attention" ? 1 : 0;
  } catch (error) {
    writeError(`${error instanceof Error ? error.message : "Pilot evidence compilation failed"}\n`);
    return 1;
  }
}

async function readRunRecords(directory: string): Promise<readonly { record: RunRecord; serialized: string }[]> {
  await assertSecureDirectory(directory, "Pilot run-record directory");
  const names = (await readdir(directory)).sort();
  if (names.some((name) => !/^[a-f0-9]{64}\.json$/.test(name))) {
    throw new TypeError("Pilot run-record directory contains an unexpected entry");
  }
  const entries = await Promise.all(names.map(async (name) => {
    const path = join(directory, name);
    await assertSecureRegularFile(path, "Pilot run record");
    const serialized = await readBoundedUtf8(path, "Pilot run record");
    const record = validateRunRecord(parseJson(serialized, "Pilot run record"));
    const expectedName = `${createHash("sha256").update(record.runId).digest("hex")}.json`;
    if (name !== expectedName) throw new TypeError("Pilot run-record filename does not match its immutable identity");
    return { record, serialized };
  }));
  const identities = entries.map(({ record }) => record.runId);
  if (new Set(identities).size !== identities.length) throw new TypeError("Pilot run records contain duplicate identities");
  return entries;
}

async function inspectBackups(directory: string, runRecords: ReadonlySet<string>): Promise<number> {
  await assertSecureDirectory(directory, "Pilot backup directory");
  const names = (await readdir(directory)).sort();
  const verified = new Set<string>();
  for (const name of names) {
    const path = join(directory, name);
    await assertSecureDirectory(path, "Pilot backup window");
    const entries = (await readdir(path)).sort();
    if (entries.length !== 2 || entries[0] !== "run-record.json" || entries[1] !== "state.json") {
      throw new TypeError("Pilot backup window must contain only state and run-record files");
    }
    const statePath = join(path, "state.json");
    const recordPath = join(path, "run-record.json");
    await Promise.all([
      assertSecureRegularFile(statePath, "Pilot backup state"),
      assertSecureRegularFile(recordPath, "Pilot backup run record"),
    ]);
    const serialized = await readBoundedUtf8(recordPath, "Pilot backup run record");
    validateRunRecord(parseJson(serialized, "Pilot backup run record"));
    if (!runRecords.has(serialized)) throw new TypeError("Pilot backup run record does not match an immutable run record");
    if (verified.has(serialized)) throw new TypeError("Pilot backup windows contain a duplicate run record");
    verified.add(serialized);
  }
  return verified.size;
}

async function assertSecureDirectory(path: string, label: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new TypeError(`${label} must be a regular directory`);
    if ((metadata.mode & 0o077) !== 0) throw new TypeError(`${label} permissions must exclude group and other access`);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError(`${label} could not be inspected`);
  }
}

async function assertSecureRegularFile(path: string, label: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new TypeError(`${label} must be a regular file`);
    if ((metadata.mode & 0o077) !== 0) throw new TypeError(`${label} permissions must exclude group and other access`);
    if (metadata.size > maximumRecordBytes) throw new TypeError(`${label} exceeds ${maximumRecordBytes} bytes`);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError(`${label} could not be inspected`);
  }
}

async function readBoundedUtf8(path: string, label: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    throw new TypeError(`${label} could not be read`);
  }
}

function parseJson(value: string, label: string): RunRecord {
  try {
    return JSON.parse(value) as RunRecord;
  } catch {
    throw new TypeError(`${label} must contain valid JSON`);
  }
}

function sumCounts(values: readonly RunRecordCounts[]): RunRecordCounts {
  return values.reduce<RunRecordCounts>((total, value) => ({
    selected: total.selected + value.selected,
    processed: total.processed + value.processed,
    changed: total.changed + value.changed,
    unchanged: total.unchanged + value.unchanged,
    skipped: total.skipped + value.skipped,
    failed: total.failed + value.failed,
  }), emptyCounts());
}

function sumFailureCategories(values: readonly RunRecordFailureCategories[]): RunRecordFailureCategories {
  return values.reduce<RunRecordFailureCategories>((total, value) => ({
    validation: total.validation + value.validation,
    authorization: total.authorization + value.authorization,
    rate_limited: total.rate_limited + value.rate_limited,
    transient: total.transient + value.transient,
    permanent: total.permanent + value.permanent,
    conflict: total.conflict + value.conflict,
  }), emptyFailureCategories());
}

function emptyCounts(): RunRecordCounts {
  return { selected: 0, processed: 0, changed: 0, unchanged: 0, skipped: 0, failed: 0 };
}

function emptyFailureCategories(): RunRecordFailureCategories {
  return { validation: 0, authorization: 0, rate_limited: 0, transient: 0, permanent: 0, conflict: 0 };
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
