#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  parseAccountFile,
  parseCompetitiveFootprintConfig,
  type ExternalCompetitiveFootprintConfig,
} from "./external-input.ts";

const maximumInputBytes = 1_048_576;
const deliveryAttemptCap = 3;

export interface PilotPreflightOptions {
  readonly configPath: string;
  readonly accountsPath: string;
  readonly statePath: string;
  readonly runRecordDirectory: string;
  readonly backupDirectory: string;
  readonly pilotPreflight: true;
}

export interface PilotPreflightReport {
  readonly command: "competitive-footprint";
  readonly mode: "limited-cohort-pilot-preflight";
  readonly status: "ready";
  readonly readOnly: true;
  readonly networkEnabled: false;
  readonly crmAccessEnabled: false;
  readonly stateWriteEnabled: false;
  readonly deliveryEnabled: false;
  readonly cohortCount: 3;
  readonly detectorCount: 3;
  readonly maximumInitialTransitions: 9;
  readonly deliveryAttemptCap: 3;
  readonly configDigest: string;
  readonly manifestDigest: string;
  readonly storage: {
    readonly state: "absent";
    readonly runRecords: "absent" | "empty";
    readonly backup: "absent" | "empty";
  };
}

export async function runPilotPreflight(
  options: PilotPreflightOptions,
  repositoryRoot = process.cwd(),
): Promise<PilotPreflightReport> {
  if (options.pilotPreflight !== true) throw new TypeError("Pilot preflight requires its explicit mode gate");
  const paths = [
    options.configPath,
    options.accountsPath,
    options.statePath,
    options.runRecordDirectory,
    options.backupDirectory,
  ];
  if (paths.some((path) => !isAbsolute(path))) throw new TypeError("Pilot paths must be absolute");
  const normalized = paths.map((path) => resolve(path));
  if (new Set(normalized).size !== normalized.length) throw new TypeError("Pilot paths must be distinct");
  const root = resolve(repositoryRoot);
  if (normalized.some((path) => isWithin(root, path))) {
    throw new TypeError("Pilot paths must be outside the repository");
  }

  const [configBytes, manifestBytes] = await Promise.all([
    readSecureInput(options.configPath, "configuration"),
    readSecureInput(options.accountsPath, "manifest"),
  ]);
  const configuration = parseCompetitiveFootprintConfig(parseJson(configBytes));
  const accountFile = parseAccountFile(parseJson(manifestBytes));
  if (accountFile.dataPolicy !== "user-supplied") throw new TypeError("Pilot manifest must be user-supplied");
  if (accountFile.accounts.length !== 3) throw new TypeError("Pilot manifest must contain exactly three accounts");
  if (new Set(accountFile.accounts.map(({ domain }) => domain)).size !== 3) {
    throw new TypeError("Pilot account domains must be unique");
  }
  const hubspotIds = accountFile.accounts.map((account) => {
    const references = account.externalReferences ?? [];
    if (references.length !== 1 || references[0]!.system !== "hubspot" || !/^\d+$/.test(references[0]!.id)) {
      throw new TypeError("Each pilot account requires one numeric HubSpot reference");
    }
    return references[0]!.id;
  });
  if (new Set(hubspotIds).size !== 3) throw new TypeError("Pilot HubSpot references must be unique");

  assertPilotDetectors(configuration);
  const [state, runRecords, backup] = await Promise.all([
    assertAbsentFile(options.statePath),
    inspectEmptyDirectory(options.runRecordDirectory, "run-record"),
    inspectEmptyDirectory(options.backupDirectory, "backup"),
  ]);
  return {
    command: "competitive-footprint",
    mode: "limited-cohort-pilot-preflight",
    status: "ready",
    readOnly: true,
    networkEnabled: false,
    crmAccessEnabled: false,
    stateWriteEnabled: false,
    deliveryEnabled: false,
    cohortCount: 3,
    detectorCount: 3,
    maximumInitialTransitions: 9,
    deliveryAttemptCap,
    configDigest: sha256(configBytes),
    manifestDigest: sha256(manifestBytes),
    storage: { state, runRecords, backup },
  };
}

export function parsePilotPreflightArgs(args: readonly string[]): PilotPreflightOptions {
  const gate = "--pilot-preflight";
  const valueFlags = ["--config", "--accounts", "--state-file", "--run-record-dir", "--backup-dir"] as const;
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
    throw new TypeError("Pilot preflight requires --pilot-preflight exactly once");
  }
  return {
    configPath: readSingleValue(args, "--config"),
    accountsPath: readSingleValue(args, "--accounts"),
    statePath: readSingleValue(args, "--state-file"),
    runRecordDirectory: readSingleValue(args, "--run-record-dir"),
    backupDirectory: readSingleValue(args, "--backup-dir"),
    pilotPreflight: true,
  };
}

export async function main(
  args: readonly string[],
  writeOutput: (value: string) => void = (value) => process.stdout.write(value),
  writeError: (value: string) => void = (value) => process.stderr.write(value),
  execute: (options: PilotPreflightOptions) => Promise<PilotPreflightReport> = runPilotPreflight,
): Promise<number> {
  if (args.includes("--help")) {
    writeOutput(
      "Usage: npm run preflight:competitive-footprint:pilot -- --pilot-preflight --config FILE --accounts FILE --state-file FILE --run-record-dir DIRECTORY --backup-dir DIRECTORY\n",
    );
    return 0;
  }
  try {
    writeOutput(`${JSON.stringify(await execute(parsePilotPreflightArgs(args)), null, 2)}\n`);
    return 0;
  } catch (error) {
    writeError(`${error instanceof Error ? error.message : "Pilot preflight failed"}\n`);
    return 1;
  }
}

function assertPilotDetectors(configuration: ExternalCompetitiveFootprintConfig): void {
  if (
    configuration.framework.detectorIds.length !== 3 ||
    configuration.dns.length !== 1 ||
    configuration.subdomain.length !== 1 ||
    configuration.tcp.length !== 1 ||
    configuration.dns[0]!.detector.rules.length !== 1 ||
    configuration.subdomain[0]!.rules.length !== 1 ||
    configuration.tcp[0]!.rules.length !== 1
  ) {
    throw new TypeError("Pilot configuration requires exactly one DNS, HTTPS, and TLS detector rule");
  }
  const dnsRule = configuration.dns[0]!.detector.rules[0]!;
  const httpRule = configuration.subdomain[0]!.rules[0]!;
  const tcpRule = configuration.tcp[0]!.rules[0]!;
  if (dnsRule.recordType !== "CNAME" || httpRule.protocol !== "https" || tcpRule.tls !== true || tcpRule.port !== 443) {
    throw new TypeError("Pilot configuration requires CNAME, HTTPS, and TLS port 443 probes");
  }
}

function parseJson(value: Buffer): unknown {
  try {
    return JSON.parse(value.toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new TypeError("Pilot inputs must contain valid JSON");
    throw error;
  }
}

async function readSecureInput(path: string, label: string): Promise<Buffer> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new TypeError(`Pilot ${label} must be a regular file`);
    if ((metadata.mode & 0o077) !== 0) throw new TypeError(`Pilot ${label} permissions must exclude group and other access`);
    if (metadata.size > maximumInputBytes) throw new TypeError(`Pilot ${label} exceeds 1048576 bytes`);
    return await readFile(path);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError(`Pilot ${label} could not be read`);
  }
}

async function assertAbsentFile(path: string): Promise<"absent"> {
  try {
    await lstat(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return "absent";
    throw new TypeError("Pilot state path could not be inspected");
  }
  throw new TypeError("Pilot state file must be absent");
}

async function inspectEmptyDirectory(path: string, label: string): Promise<"absent" | "empty"> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new TypeError(`Pilot ${label} path must be an empty directory or absent`);
    }
    if ((metadata.mode & 0o077) !== 0) {
      throw new TypeError(`Pilot ${label} directory permissions must exclude group and other access`);
    }
    if ((await readdir(path)).length !== 0) throw new TypeError(`Pilot ${label} directory must be empty`);
    return "empty";
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return "absent";
    if (error instanceof TypeError) throw error;
    throw new TypeError(`Pilot ${label} path could not be inspected`);
  }
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function readSingleValue(args: readonly string[], flag: string): string {
  const indexes = args.flatMap((value, index) => (value === flag ? [index] : []));
  if (indexes.length !== 1) throw new TypeError(`${flag} must appear once`);
  return args[indexes[0]! + 1]!;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  process.exitCode = await main(process.argv.slice(2));
}
