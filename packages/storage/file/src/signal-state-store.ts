import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  SignalObservation,
  SignalState,
  SignalStateStore,
  SignalTransition,
} from "@growth-frameworks/contracts/competitive-footprint";
import { PortOperationError, validateObservation } from "@growth-frameworks/contracts/competitive-footprint";

const schemaVersion = 1;

interface PersistedOperation {
  readonly key: string;
  readonly observation: SignalObservation;
  readonly transition: SignalTransition | null;
}

interface StateDocument {
  readonly schemaVersion: 1;
  readonly states: readonly SignalState[];
  readonly operations: readonly PersistedOperation[];
}

export interface FileSignalStateStoreOptions {
  readonly path: string;
  readonly allowWrite: true;
}

export class FileSignalStateStore implements SignalStateStore {
  readonly #path: string;

  constructor(options: FileSignalStateStoreOptions) {
    if (options.allowWrite !== true) {
      throw new PortOperationError("File state writes require explicit authorization", "authorization", false);
    }
    if (options.path.trim().length === 0) throw new TypeError("State file path is required");
    this.#path = options.path;
  }

  async get(accountId: string, detectorId: string): Promise<SignalState | null> {
    const document = await this.#readDocument();
    return document.states.find((state) => state.accountId === accountId && state.detectorId === detectorId) ?? null;
  }

  async record(
    observation: SignalObservation,
    next: SignalState,
    transition: SignalTransition | null,
  ): Promise<"created" | "duplicate"> {
    assertRecordIdentity(observation, next, transition);
    return this.#withLock(async () => {
      const document = await this.#readDocument();
      const key = operationIdentity(observation);
      if (document.operations.some((operation) => operation.key === key)) return "duplicate";

      const states = document.states.filter(
        (state) => state.accountId !== next.accountId || state.detectorId !== next.detectorId,
      );
      await this.#replaceDocument({
        schemaVersion,
        states: [...states, next],
        operations: [...document.operations, { key, observation, transition }],
      });
      return "created";
    });
  }

  async #readDocument(): Promise<StateDocument> {
    await assertNotSymlink(this.#path);
    let text: string;
    try {
      text = await readFile(this.#path, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return emptyDocument();
      throw error;
    }
    try {
      return parseDocument(JSON.parse(text));
    } catch (error) {
      throw new PortOperationError("State file is invalid or corrupted", "permanent", false, { cause: error });
    }
  }

  async #withLock<T>(operation: () => Promise<T>): Promise<T> {
    const lockPath = `${this.#path}.lock`;
    await mkdir(dirname(this.#path), { recursive: true });
    try {
      await mkdir(lockPath);
    } catch (error) {
      if (isNodeError(error, "EEXIST")) {
        throw new PortOperationError("State file is locked by another writer", "conflict", true, { cause: error });
      }
      throw error;
    }
    try {
      return await operation();
    } finally {
      await rm(lockPath, { recursive: true, force: true });
    }
  }

  async #replaceDocument(document: StateDocument): Promise<void> {
    const parent = dirname(this.#path);
    await mkdir(parent, { recursive: true });
    const temporaryPath = `${this.#path}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      await rename(temporaryPath, this.#path);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}

function emptyDocument(): StateDocument {
  return { schemaVersion, states: [], operations: [] };
}

function operationIdentity(observation: SignalObservation): string {
  return [observation.accountId, observation.detectorId, observation.observedAt, observation.fingerprint].join("\u0000");
}

function assertRecordIdentity(
  observation: SignalObservation,
  next: SignalState,
  transition: SignalTransition | null,
): void {
  if (observation.accountId !== next.accountId || observation.detectorId !== next.detectorId) {
    throw new Error("Stored state identity does not match observation identity");
  }
  if (
    transition !== null &&
    (transition.accountId !== observation.accountId || transition.detectorId !== observation.detectorId)
  ) {
    throw new Error("Transition identity does not match observation identity");
  }
}

function parseDocument(value: unknown): StateDocument {
  if (!isRecord(value) || value.schemaVersion !== schemaVersion) throw new TypeError("Unsupported state schema");
  if (!Array.isArray(value.states) || !value.states.every(isSignalState)) throw new TypeError("Invalid states");
  if (!Array.isArray(value.operations) || !value.operations.every(isPersistedOperation)) {
    throw new TypeError("Invalid operations");
  }
  return value as unknown as StateDocument;
}

function isSignalState(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.accountId === "string" &&
    typeof value.detectorId === "string" &&
    ["unknown", "possible", "confirmed", "historical", "lost"].includes(String(value.state)) &&
    (value.confidence === null || ["low", "medium", "high"].includes(String(value.confidence))) &&
    (value.lastCheckedAt === null || typeof value.lastCheckedAt === "string") &&
    (value.lastConclusiveObservationAt === null || typeof value.lastConclusiveObservationAt === "string") &&
    Array.isArray(value.evidenceCodes) &&
    value.evidenceCodes.every((code) => typeof code === "string") &&
    Number.isInteger(value.version) &&
    Number(value.version) >= 0
  );
}

function isPersistedOperation(value: unknown): boolean {
  if (!isRecord(value) || typeof value.key !== "string" || !isRecord(value.observation)) return false;
  try {
    validateObservation(value.observation as unknown as SignalObservation);
  } catch {
    return false;
  }
  if (value.transition === null) return true;
  if (!isRecord(value.transition)) return false;
  return (
    typeof value.transition.idempotencyKey === "string" &&
    ["detected", "confidence_upgraded", "signal_changed", "lost", "restored", "cleared"].includes(
      String(value.transition.kind),
    ) &&
    typeof value.transition.accountId === "string" &&
    typeof value.transition.detectorId === "string" &&
    typeof value.transition.occurredAt === "string" &&
    isSignalState(value.transition.previous) &&
    isSignalState(value.transition.next)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function assertNotSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new PortOperationError("State file must not be a symbolic link", "authorization", false);
    }
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
