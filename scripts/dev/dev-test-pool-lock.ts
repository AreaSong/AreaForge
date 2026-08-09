import { closeSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { DEV_TEST_POOL } from "./dev-test-pool-core";

export function defaultPoolLockPath(): string {
  return path.join(tmpdir(), `${DEV_TEST_POOL}-${process.getuid?.() ?? "user"}.lock`);
}

export function acquirePoolLock(
  lockPath = defaultPoolLockPath(),
  staleAfterMs = 15 * 60_000,
): () => void {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, "wx", 0o600);
      writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      return () => {
        closeSync(fd);
        unlinkSync(lockPath);
      };
    } catch (error) {
      if (!isCode(error, "EEXIST") || !removeStaleLock(lockPath, staleAfterMs)) {
        throw new Error("another AreaForge test-pool operation is active");
      }
    }
  }
  throw new Error("unable to acquire the AreaForge test-pool lock");
}

function removeStaleLock(lockPath: string, staleAfterMs: number): boolean {
  try {
    const stat = lstatSync(lockPath);
    if (!stat.isFile() || stat.isSymbolicLink() || Date.now() - stat.mtimeMs < staleAfterMs) return false;
    const record = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number };
    if (record.pid && processExists(record.pid)) return false;
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isCode(error, "EPERM");
  }
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
