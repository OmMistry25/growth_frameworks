import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  SignalObservation,
  SignalState,
  SignalStateStore,
  SignalTransition,
  PendingTransitionDelivery,
  TransitionOutbox,
} from "@growth-frameworks/contracts/competitive-footprint";
import { PortOperationError, validateObservation } from "@growth-frameworks/contracts/competitive-footprint";

const schemaVersion = 2;

interface DeliveryState {
  readonly status: "pending" | "delivered";
  readonly attempts: number;
  readonly lastAttemptAt: string | null;
  readonly deliveredAt: string | null;
}

interface PersistedOperation {
  readonly key: string;
  readonly observation: SignalObservation;
  readonly transition: SignalTransition | null;
  readonly delivery: DeliveryState | null;
}

interface StateDocument {
  readonly schemaVersion: 2;
  readonly states: readonly SignalState[];
  readonly operations: readonly PersistedOperation[];
}

export interface FileSignalStateStoreOptions {
  readonly path: string;
  readonly allowWrite: true;
}

export class FileSignalStateStore implements SignalStateStore, TransitionOutbox {
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
        operations: [
          ...document.operations,
          {
            key,
            observation,
            transition,
            delivery: transition === null ? null : pendingDelivery(),
          },
        ],
      });
      return "created";
    });
  }

  async listPending(limit: number): Promise<readonly PendingTransitionDelivery[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError("Outbox limit must be an integer from 1 to 100");
    }
    const document = await this.#readDocument();
    return document.operations.flatMap((operation) => {
      if (operation.transition === null || operation.delivery?.status !== "pending") return [];
      return [{
        transition: operation.transition,
        attempts: operation.delivery.attempts,
        lastAttemptAt: operation.delivery.lastAttemptAt,
      }];
    }).slice(0, limit);
  }

  async recordAttempt(
    idempotencyKey: string,
    expectedAttempts: number,
    attemptedAt: string,
  ): Promise<"recorded" | "missing" | "delivered" | "conflict"> {
    if (!Number.isInteger(expectedAttempts) || expectedAttempts < 0) {
      throw new TypeError("Expected delivery attempts must be a non-negative integer");
    }
    assertTimestamp(attemptedAt, "attempt time");
    return this.#withLock(async () => {
      const document = await this.#readDocument();
      const index = findTransitionIndex(document, idempotencyKey);
      if (index === -1) return "missing";
      const operation = document.operations[index]!;
      if (operation.delivery?.status === "delivered") return "delivered";
      if (operation.delivery === null) return "missing";
      if (operation.delivery.attempts !== expectedAttempts) return "conflict";
      const operations = [...document.operations];
      operations[index] = {
        ...operation,
        delivery: {
          ...operation.delivery,
          attempts: operation.delivery.attempts + 1,
          lastAttemptAt: attemptedAt,
        },
      };
      await this.#replaceDocument({ ...document, operations });
      return "recorded";
    });
  }

  async markDelivered(
    idempotencyKey: string,
    deliveredAt: string,
  ): Promise<"recorded" | "missing" | "duplicate"> {
    assertTimestamp(deliveredAt, "delivery time");
    return this.#withLock(async () => {
      const document = await this.#readDocument();
      const index = findTransitionIndex(document, idempotencyKey);
      if (index === -1) return "missing";
      const operation = document.operations[index]!;
      if (operation.delivery?.status === "delivered") return "duplicate";
      if (operation.delivery === null) return "missing";
      if (operation.delivery.attempts === 0 || operation.delivery.lastAttemptAt === null) {
        throw new PortOperationError("Delivery attempt must be recorded before its receipt", "conflict", false);
      }
      if (Date.parse(deliveredAt) < Date.parse(operation.delivery.lastAttemptAt)) {
        throw new PortOperationError("Delivery receipt cannot precede its latest attempt", "conflict", false);
      }
      const operations = [...document.operations];
      operations[index] = {
        ...operation,
        delivery: {
          ...operation.delivery,
          status: "delivered",
          deliveredAt,
        },
      };
      await this.#replaceDocument({ ...document, operations });
      return "recorded";
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

function pendingDelivery(): DeliveryState {
  return { status: "pending", attempts: 0, lastAttemptAt: null, deliveredAt: null };
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
  if (!isRecord(value) || (value.schemaVersion !== 1 && value.schemaVersion !== schemaVersion)) {
    throw new TypeError("Unsupported state schema");
  }
  const version: 1 | 2 = value.schemaVersion;
  if (!Array.isArray(value.states) || !value.states.every(isSignalState)) throw new TypeError("Invalid states");
  if (!Array.isArray(value.operations) || !value.operations.every((item) => isPersistedOperation(item, version))) {
    throw new TypeError("Invalid operations");
  }
  return {
    schemaVersion,
    states: value.states as unknown as readonly SignalState[],
    operations: (value.operations as unknown as Array<PersistedOperation & { delivery?: DeliveryState | null }>).map(
      (operation) => ({
        key: operation.key,
        observation: operation.observation,
        transition: operation.transition,
        delivery: operation.delivery ?? (operation.transition === null ? null : pendingDelivery()),
      }),
    ),
  };
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

function isPersistedOperation(value: unknown, version: 1 | 2): boolean {
  if (!isRecord(value) || typeof value.key !== "string" || !isRecord(value.observation)) return false;
  try {
    validateObservation(value.observation as unknown as SignalObservation);
  } catch {
    return false;
  }
  if (value.transition === null) return version === 1 || value.delivery === null;
  if (!isRecord(value.transition)) return false;
  const transitionIsValid = (
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
  if (!transitionIsValid) return false;
  return version === 1 || isDeliveryState(value.delivery);
}

function isDeliveryState(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    (value.status === "pending" || value.status === "delivered") &&
    Number.isInteger(value.attempts) &&
    Number(value.attempts) >= 0 &&
    (value.lastAttemptAt === null || isTimestamp(value.lastAttemptAt)) &&
    (value.deliveredAt === null || isTimestamp(value.deliveredAt)) &&
    (value.status === "pending"
      ? value.deliveredAt === null
      : value.deliveredAt !== null && Number(value.attempts) > 0 && value.lastAttemptAt !== null)
  );
}

function findTransitionIndex(document: StateDocument, idempotencyKey: string): number {
  return document.operations.findIndex((operation) => operation.transition?.idempotencyKey === idempotencyKey);
}

function assertTimestamp(value: string, label: string): void {
  if (!isTimestamp(value)) throw new TypeError(`Outbox ${label} must be a valid ISO timestamp`);
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
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
