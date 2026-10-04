import { getBrowserStoragePortOrMemory } from "@/lib/client/storage-port";
import type {
  FocusOfflineCommand,
  FocusOfflineSnapshot,
} from "./focus-offline-contract";

export const DATABASE_NAME = "areaforge-focus-local-v1";
export const DATABASE_VERSION = 2;
export const COMMAND_STORE = "commands";
export const SNAPSHOT_STORE = "snapshots";
export const LOCK_STORE = "locks";
export const FALLBACK_COMMANDS_KEY = "areaforge.focus.commands.v1";
export const FALLBACK_COMMAND_PREFIX = `${FALLBACK_COMMANDS_KEY}.`;
export const FALLBACK_SNAPSHOT_PREFIX = "areaforge.focus.snapshot.v1.";
export const FOCUS_SYNC_LOCK_PREFIX = "areaforge.focus.sync.lock.";
export const FOCUS_SYNC_LOCK_TTL_MS = 20_000;

export type StoreName = typeof COMMAND_STORE | typeof SNAPSHOT_STORE | typeof LOCK_STORE;
export type StoreMode = "readonly" | "readwrite";

export function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function canUseIndexedDb(): boolean {
  return isBrowser() && typeof indexedDB !== "undefined";
}

export function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function randomSourceId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fallbackSnapshotKey(userId: string): string {
  return `${FALLBACK_SNAPSHOT_PREFIX}${userId}`;
}

export function readFallbackSnapshot(userId: string): FocusOfflineSnapshot | null {
  try {
    const raw = getBrowserStoragePortOrMemory("local").getItem(fallbackSnapshotKey(userId));
    return raw ? JSON.parse(raw) as FocusOfflineSnapshot : null;
  } catch {
    return null;
  }
}

export function writeFallbackSnapshot(snapshot: FocusOfflineSnapshot): void {
  try {
    getBrowserStoragePortOrMemory("local").setItem(fallbackSnapshotKey(snapshot.userId), JSON.stringify(snapshot));
  } catch {
    // The queue remains best-effort when browser storage is unavailable.
  }
}

export function removeFallbackSnapshot(userId: string): void {
  try {
    getBrowserStoragePortOrMemory("local").removeItem(fallbackSnapshotKey(userId));
  } catch {
    // The fallback copy is optional when browser storage is unavailable.
  }
}

export function readFallbackCommands(): FocusOfflineCommand[] {
  try {
    migrateLegacyFallbackCommands();
    const commands: FocusOfflineCommand[] = [];
    const storage = getBrowserStoragePortOrMemory("local");
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(FALLBACK_COMMAND_PREFIX)) continue;
      const raw = storage.getItem(key);
      if (!raw) continue;
      try {
        const command = JSON.parse(raw) as FocusOfflineCommand;
        if (command.id && key === fallbackCommandKey(command.id)) commands.push(command);
      } catch {
        // 单条命令损坏时跳过它，保证其余队列仍可读取。
      }
    }
    return commands;
  } catch {
    return [];
  }
}

function fallbackCommandKey(commandId: string): string {
  return `${FALLBACK_COMMAND_PREFIX}${commandId}`;
}

function migrateLegacyFallbackCommands(): void {
  try {
    const storage = getBrowserStoragePortOrMemory("local");
    const raw = storage.getItem(FALLBACK_COMMANDS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      for (const command of parsed) {
        if (!command || typeof command !== "object" || typeof (command as { id?: unknown }).id !== "string") continue;
        storage.setItem(fallbackCommandKey((command as { id: string }).id), JSON.stringify(command));
      }
    }
    storage.removeItem(FALLBACK_COMMANDS_KEY);
  } catch {
    // The queue remains best-effort when browser storage is unavailable.
  }
}

export function writeFallbackCommand(command: FocusOfflineCommand): void {
  try {
    getBrowserStoragePortOrMemory("local").setItem(fallbackCommandKey(command.id), JSON.stringify(command));
  } catch {
    // The queue remains best-effort when browser storage is unavailable.
  }
}

export function readFallbackCommand(commandId: string): FocusOfflineCommand | null {
  try {
    const raw = getBrowserStoragePortOrMemory("local").getItem(fallbackCommandKey(commandId));
    return raw ? JSON.parse(raw) as FocusOfflineCommand : null;
  } catch {
    return null;
  }
}

export function removeFallbackCommand(commandId: string): void {
  try {
    getBrowserStoragePortOrMemory("local").removeItem(fallbackCommandKey(commandId));
  } catch {
    // The queue remains best-effort when browser storage is unavailable.
  }
}

export function clearFallbackCommandsForUser(userId: string): void {
  for (const command of readFallbackCommands()) {
    if (command.userId === userId) removeFallbackCommand(command.id);
  }
}

export function stripSnapshotId(snapshot: FocusOfflineSnapshot & { id: string }): FocusOfflineSnapshot {
  const value = { ...snapshot } as FocusOfflineSnapshot & { id?: string };
  delete value.id;
  return value;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(COMMAND_STORE)) database.createObjectStore(COMMAND_STORE, { keyPath: "id" });
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) database.createObjectStore(SNAPSHOT_STORE, { keyPath: "id" });
      if (!database.objectStoreNames.contains(LOCK_STORE)) database.createObjectStore(LOCK_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
}

export async function withStore<T>(
  storeName: StoreName,
  mode: StoreMode,
  callback: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result: T | undefined;
    let callbackSettled = false;
    let transactionCompleted = false;
    let callbackError: unknown;
    let callbackFailed = false;
    let settled = false;
    const finish = () => {
      if (settled) return;
      if (callbackFailed) {
        settled = true;
        reject(callbackError);
        return;
      }
      if (callbackSettled && transactionCompleted) {
        settled = true;
        resolve(result as T);
      }
    };

    callback(store).then((value) => {
      callbackSettled = true;
      result = value;
      finish();
    }, (error: unknown) => {
      callbackSettled = true;
      callbackFailed = true;
      callbackError = error;
      try {
        transaction.abort();
      } catch {
        // The transaction may already have completed; the original error is enough.
      }
      finish();
    });
    transaction.oncomplete = () => {
      transactionCompleted = true;
      finish();
    };
    transaction.onerror = () => {
      if (settled) return;
      settled = true;
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    };
    transaction.onabort = () => {
      if (settled) return;
      settled = true;
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    };
  }).finally(() => database.close());
}

export function withCommandStore<T>(mode: StoreMode, callback: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  return withStore(COMMAND_STORE, mode, callback);
}

export function withSnapshotStore<T>(mode: StoreMode, callback: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  return withStore(SNAPSHOT_STORE, mode, callback);
}

export function withLockStore<T>(mode: StoreMode, callback: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  return withStore(LOCK_STORE, mode, callback);
}

export function requestPromise<T = undefined>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}
