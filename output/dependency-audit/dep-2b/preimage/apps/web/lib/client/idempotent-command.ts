import { stableStringify } from "@areaforge/core";
import { getBrowserStoragePort } from "@/lib/client/storage-port";

const commandStoragePrefix = "areaforge.command.";
const commandTtlMs = 24 * 60 * 60 * 1000;

interface StoredCommandIdentity {
  fingerprint: string;
  idempotencyKey: string;
  updatedAt: number;
}

export function getOrCreateIdempotencyKey(scope: string, prefix: string, payload: unknown): string {
  const fingerprint = localPayloadFingerprint(payload);
  const storageKey = commandStorageKey(scope);
  const existing = readStoredCommand(storageKey);
  if (existing?.fingerprint === fingerprint) return existing.idempotencyKey;

  const idempotencyKey = `${prefix}-${createRandomIdentity()}`;
  writeStoredCommand(storageKey, { fingerprint, idempotencyKey, updatedAt: Date.now() });
  return idempotencyKey;
}

export function completeIdempotentCommand(scope: string): void {
  const storage = getBrowserStoragePort("session");
  if (!storage) return;
  try {
    storage.removeItem(commandStorageKey(scope));
  } catch {
    // The server remains authoritative when browser storage is unavailable.
  }
}

function commandStorageKey(scope: string): string {
  return `${commandStoragePrefix}${scope.replace(/[^a-zA-Z0-9:._-]/g, "_")}`;
}

function readStoredCommand(storageKey: string): StoredCommandIdentity | null {
  const storage = getBrowserStoragePort("session");
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) ?? "null") as Partial<StoredCommandIdentity> | null;
    if (
      !parsed ||
      typeof parsed.fingerprint !== "string" ||
      typeof parsed.idempotencyKey !== "string" ||
      typeof parsed.updatedAt !== "number" ||
      Date.now() - parsed.updatedAt > commandTtlMs
    ) {
      storage.removeItem(storageKey);
      return null;
    }
    return parsed as StoredCommandIdentity;
  } catch {
    return null;
  }
}

function writeStoredCommand(storageKey: string, value: StoredCommandIdentity): void {
  const storage = getBrowserStoragePort("session");
  if (!storage) return;
  try {
    storage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // In-memory submission still works; only cross-navigation replay protection degrades.
  }
}

function localPayloadFingerprint(payload: unknown): string {
  const value = stableStringify(payload);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function createRandomIdentity(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
