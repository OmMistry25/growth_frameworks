import { createHash, randomUUID } from "node:crypto";
import { chmod, link, lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import type { RunRecord, RunRecordStore } from "@growth-frameworks/contracts/competitive-footprint";
import { PortOperationError, validateRunRecord } from "@growth-frameworks/contracts/competitive-footprint";

export interface FileRunRecordStoreOptions {
  readonly directory: string;
  readonly allowWrite: true;
}

export class FileRunRecordStore implements RunRecordStore {
  readonly #directory: string;

  constructor(options: FileRunRecordStoreOptions) {
    if (options.allowWrite !== true) {
      throw new PortOperationError("Run record writes require explicit authorization", "authorization", false);
    }
    if (options.directory.trim().length === 0) throw new TypeError("Run record directory is required");
    this.#directory = options.directory;
  }

  async record(record: RunRecord): Promise<"created" | "duplicate"> {
    validateRunRecord(record);
    await this.#prepareDirectory();
    const serialized = `${JSON.stringify(record, null, 2)}\n`;
    const digest = createHash("sha256").update(record.runId).digest("hex");
    const target = join(this.#directory, `${digest}.json`);
    const existing = await readExisting(target);
    if (existing !== null) return compareExisting(existing, serialized);

    const temporary = join(this.#directory, `.${digest}.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
      await handle.close();
      try {
        await link(temporary, target);
      } catch (error) {
        if (!isNodeError(error, "EEXIST")) throw error;
        const raced = await readExisting(target);
        if (raced === null) throw error;
        return compareExisting(raced, serialized);
      }
      await rm(temporary, { force: true });
      await syncDirectory(this.#directory);
      return "created";
    } finally {
      await handle.close().catch(() => undefined);
      await rm(temporary, { force: true });
    }
  }

  async #prepareDirectory(): Promise<void> {
    await assertNotSymlink(this.#directory, "Run record directory must not be a symbolic link");
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(this.#directory);
    if (!metadata.isDirectory()) throw new TypeError("Run record path must be a directory");
    await chmod(this.#directory, 0o700);
  }
}

async function readExisting(path: string): Promise<string | null> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new PortOperationError("Run record target must be a regular file", "authorization", false);
    }
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return null;
    throw error;
  }
}

function compareExisting(existing: string, expected: string): "duplicate" {
  if (existing === expected) return "duplicate";
  throw new PortOperationError("Run record identity already exists with different content", "conflict", false);
}

async function assertNotSymlink(path: string, message: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new PortOperationError(message, "authorization", false);
    }
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
