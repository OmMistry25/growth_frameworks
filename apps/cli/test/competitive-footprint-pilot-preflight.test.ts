import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  main,
  parsePilotPreflightArgs,
  runPilotPreflight,
  type PilotPreflightOptions,
} from "../src/competitive-footprint-pilot-preflight.ts";

const exampleConfigPath = fileURLToPath(
  new URL("../../../examples/competitive-footprint/config.json", import.meta.url),
);

test("reports aggregate readiness for one exact synthetic cohort", async (context) => {
  const fixture = await createFixture(context);
  const report = await runPilotPreflight(fixture.options, fixture.repositoryRoot);
  assert.deepEqual(
    {
      status: report.status,
      readOnly: report.readOnly,
      network: report.networkEnabled,
      crm: report.crmAccessEnabled,
      writes: report.stateWriteEnabled,
      delivery: report.deliveryEnabled,
      cohort: report.cohortCount,
      detectors: report.detectorCount,
      transitions: report.maximumInitialTransitions,
      attempts: report.deliveryAttemptCap,
      storage: report.storage,
    },
    {
      status: "ready",
      readOnly: true,
      network: false,
      crm: false,
      writes: false,
      delivery: false,
      cohort: 3,
      detectors: 3,
      transitions: 9,
      attempts: 3,
      storage: { state: "absent", runRecords: "empty", backup: "empty" },
    },
  );
  assert.match(report.configDigest, /^[a-f0-9]{64}$/);
  assert.match(report.manifestDigest, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-|example[123]\.com|10000[123]|HubSpot/i);
});

test("requires the explicit gate and every path exactly once", () => {
  const required = [
    "--pilot-preflight",
    "--config", "/secure/config.json",
    "--accounts", "/secure/accounts.json",
    "--state-file", "/secure/state.json",
    "--run-record-dir", "/secure/runs",
    "--backup-dir", "/secure/backup",
  ];
  assert.deepEqual(parsePilotPreflightArgs(required).pilotPreflight, true);
  assert.throws(() => parsePilotPreflightArgs(required.filter((value) => value !== "--pilot-preflight")), /exactly once/);
  assert.throws(() => parsePilotPreflightArgs([...required, "--config", "/other.json"]), /--config must appear once/);
  assert.throws(() => parsePilotPreflightArgs([...required, "--allow-network"]), /Unknown argument/);
});

test("rejects a broad, ambiguous, or repository-local cohort", async (context) => {
  const fixture = await createFixture(context);
  const manifest = JSON.parse(await readFile(fixture.options.accountsPath, "utf8")) as {
    accounts: Array<{
      id: string;
      displayName: string;
      domain: string;
      segment: "standard";
      externalReferences: Array<{ system: string; id: string }>;
    }>;
  };
  manifest.accounts.pop();
  await writeSecureJson(fixture.options.accountsPath, manifest);
  await assert.rejects(() => runPilotPreflight(fixture.options, fixture.repositoryRoot), /exactly three/);

  manifest.accounts.push({
    id: "account:synthetic-3",
    displayName: "Synthetic 3",
    domain: manifest.accounts[0]!.domain,
    segment: "standard",
    externalReferences: [{ system: "hubspot", id: "100003" }],
  });
  await writeSecureJson(fixture.options.accountsPath, manifest);
  await assert.rejects(() => runPilotPreflight(fixture.options, fixture.repositoryRoot), /domains must be unique|display name/i);

  await assert.rejects(
    () => runPilotPreflight({ ...fixture.options, statePath: join(fixture.repositoryRoot, "state.json") }, fixture.repositoryRoot),
    /outside the repository/,
  );
});

test("rejects unsafe inputs and nonempty operational storage", async (context) => {
  const fixture = await createFixture(context);
  await chmod(fixture.options.accountsPath, 0o644);
  await assert.rejects(() => runPilotPreflight(fixture.options, fixture.repositoryRoot), /permissions/);
  await chmod(fixture.options.accountsPath, 0o600);
  await writeFile(join(fixture.options.runRecordDirectory, "existing.json"), "{}\n", { mode: 0o600 });
  await assert.rejects(() => runPilotPreflight(fixture.options, fixture.repositoryRoot), /must be empty/);

  const alternate = join(fixture.operationsRoot, "alternate-runs");
  await symlink(fixture.options.runRecordDirectory, alternate);
  await assert.rejects(
    () => runPilotPreflight({ ...fixture.options, runRecordDirectory: alternate }, fixture.repositoryRoot),
    /empty directory or absent/,
  );
});

test("CLI refuses invalid input before invoking its runner", async () => {
  let executed = false;
  let error = "";
  const exitCode = await main(
    ["--pilot-preflight"],
    () => undefined,
    (value) => { error += value; },
    async () => {
      executed = true;
      throw new Error("runner must not execute");
    },
  );
  assert.equal(exitCode, 1);
  assert.equal(executed, false);
  assert.match(error, /--config must appear once/);
});

test("filesystem failures do not expose pilot paths", async (context) => {
  const fixture = await createFixture(context);
  const missing = join(fixture.operationsRoot, "private-company-manifest.json");
  await assert.rejects(
    () => runPilotPreflight({ ...fixture.options, accountsPath: missing }, fixture.repositoryRoot),
    (error: unknown) => error instanceof Error && error.message === "Pilot manifest could not be read" && !error.message.includes(missing),
  );
});

async function createFixture(context: test.TestContext): Promise<{
  readonly repositoryRoot: string;
  readonly operationsRoot: string;
  readonly options: PilotPreflightOptions;
}> {
  const root = await mkdtemp(join(tmpdir(), "growth-frameworks-pilot-preflight-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const repositoryRoot = join(root, "repository");
  const operationsRoot = join(root, "operations");
  const runRecordDirectory = join(operationsRoot, "runs");
  const backupDirectory = join(operationsRoot, "backup");
  await Promise.all([
    mkdir(repositoryRoot, { mode: 0o700 }),
    mkdir(runRecordDirectory, { recursive: true, mode: 0o700 }),
    mkdir(backupDirectory, { recursive: true, mode: 0o700 }),
  ]);
  const configPath = join(operationsRoot, "config.json");
  const accountsPath = join(operationsRoot, "accounts.json");
  await writeFile(configPath, await readFile(exampleConfigPath), { mode: 0o600 });
  await writeSecureJson(accountsPath, {
    schemaVersion: 1,
    dataPolicy: "user-supplied",
    accounts: [1, 2, 3].map((index) => ({
      id: `account:synthetic-${index}`,
      displayName: `Synthetic ${index}`,
      domain: `example${index}.com`,
      segment: "standard",
      externalReferences: [{ system: "hubspot", id: `10000${index}` }],
    })),
  });
  return {
    repositoryRoot,
    operationsRoot,
    options: {
      configPath,
      accountsPath,
      statePath: join(operationsRoot, "state.json"),
      runRecordDirectory,
      backupDirectory,
      pilotPreflight: true,
    },
  };
}

async function writeSecureJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}
