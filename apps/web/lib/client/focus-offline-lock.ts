import { getBrowserStoragePortOrMemory } from "@/lib/client/storage-port";
import {
  canUseIndexedDb,
  FOCUS_SYNC_LOCK_PREFIX,
  FOCUS_SYNC_LOCK_TTL_MS,
  isBrowser,
  randomId,
  withLockStore,
  requestPromise,
} from "./focus-offline-storage";

interface FocusSyncLease {
  key: string;
  owner: string;
  expiresAt: number;
}

export async function withFocusSyncLock<T>(
  userId: string,
  sourceId: string,
  countPending: () => Promise<number>,
  callback: () => Promise<T>,
): Promise<T> {
  if (!isBrowser()) return callback();
  const locks = (navigator as Navigator & {
    locks?: {
      request: <R>(name: string, options: { mode: "exclusive" }, callback: () => Promise<R>) => Promise<R>;
    };
  }).locks;
  if (locks) return locks.request(`${FOCUS_SYNC_LOCK_PREFIX}${userId}`, { mode: "exclusive" }, callback);

  if (canUseIndexedDb()) {
    const key = `${FOCUS_SYNC_LOCK_PREFIX}${userId}`;
    const deadline = Date.now() + FOCUS_SYNC_LOCK_TTL_MS;
    let lock: FocusSyncLease | null = null;
    let indexedDbAvailable = true;
    while (Date.now() < deadline) {
      const attempt = await acquireIndexedDbLease(key, sourceId);
      if (attempt === "unavailable") {
        indexedDbAvailable = false;
        break;
      }
      if (attempt) {
        lock = attempt;
        break;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    if (lock) {
      const renew = window.setInterval(() => {
        void renewIndexedDbLease(lock.key, lock.owner);
      }, Math.max(1_000, Math.floor(FOCUS_SYNC_LOCK_TTL_MS / 3)));
      try {
        return await callback();
      } finally {
        window.clearInterval(renew);
        await releaseIndexedDbLease(lock.key, lock.owner);
      }
    }
    if (indexedDbAvailable) return pendingResult(countPending) as T;
  }

  const owner = `${sourceId}:${randomId()}`;
  const key = `${FOCUS_SYNC_LOCK_PREFIX}${userId}`;
  const deadline = Date.now() + FOCUS_SYNC_LOCK_TTL_MS;
  while (Date.now() < deadline) {
    const acquired = tryAcquireFocusLease(key, owner);
    if (acquired === "unavailable") return pendingResult(countPending) as T;
    if (acquired) {
      const renew = window.setInterval(() => {
        renewFocusLease(key, owner);
      }, Math.max(1_000, Math.floor(FOCUS_SYNC_LOCK_TTL_MS / 3)));
      try {
        return await callback();
      } finally {
        window.clearInterval(renew);
        releaseFocusLease(key, owner);
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  return pendingResult(countPending) as T;
}

async function pendingResult(countPending: () => Promise<number>): Promise<{ state: "pending" | "current"; session: null; pendingCount: number }> {
  const pendingCount = await countPending();
  return { state: pendingCount > 0 ? "pending" : "current", session: null, pendingCount };
}

async function acquireIndexedDbLease(key: string, sourceId: string): Promise<FocusSyncLease | null | "unavailable"> {
  const owner = `${sourceId}:${randomId()}`;
  const now = Date.now();
  try {
    return await withLockStore("readwrite", async (store) => {
      const current = await requestPromise<FocusSyncLease | undefined>(store.get(key));
      if (current?.owner && current.expiresAt > now && current.owner !== owner) return null;
      const lease = { key, owner, expiresAt: now + FOCUS_SYNC_LOCK_TTL_MS };
      await requestPromise(store.put(lease));
      return lease;
    });
  } catch {
    return "unavailable";
  }
}

async function renewIndexedDbLease(key: string, owner: string): Promise<void> {
  try {
    await withLockStore("readwrite", async (store) => {
      const current = await requestPromise<FocusSyncLease | undefined>(store.get(key));
      if (current?.owner === owner) await requestPromise(store.put({ ...current, expiresAt: Date.now() + FOCUS_SYNC_LOCK_TTL_MS }));
    });
  } catch {
    // The lease naturally expires if the browser closes or IndexedDB fails.
  }
}

async function releaseIndexedDbLease(key: string, owner: string): Promise<void> {
  try {
    await withLockStore("readwrite", async (store) => {
      const current = await requestPromise<FocusSyncLease | undefined>(store.get(key));
      if (current?.owner === owner) await requestPromise(store.delete(key));
    });
  } catch {
    // Lease expiry is the recovery path for a failed release.
  }
}

function tryAcquireFocusLease(key: string, owner: string): boolean | "unavailable" {
  try {
    const now = Date.now();
    const storage = getBrowserStoragePortOrMemory("local");
    const current = JSON.parse(storage.getItem(key) ?? "null") as { owner?: string; expiresAt?: number } | null;
    if (current?.owner && typeof current.expiresAt === "number" && current.expiresAt > now && current.owner !== owner) return false;
    storage.setItem(key, JSON.stringify({ owner, expiresAt: now + FOCUS_SYNC_LOCK_TTL_MS }));
    const claimed = JSON.parse(storage.getItem(key) ?? "null") as { owner?: string } | null;
    return claimed?.owner === owner;
  } catch {
    return "unavailable";
  }
}

function renewFocusLease(key: string, owner: string): void {
  try {
    const storage = getBrowserStoragePortOrMemory("local");
    const current = JSON.parse(storage.getItem(key) ?? "null") as { owner?: string } | null;
    if (current?.owner === owner) storage.setItem(key, JSON.stringify({ owner, expiresAt: Date.now() + FOCUS_SYNC_LOCK_TTL_MS }));
  } catch {
    // The lease expires on its own when storage is unavailable.
  }
}

function releaseFocusLease(key: string, owner: string): void {
  try {
    const storage = getBrowserStoragePortOrMemory("local");
    const current = JSON.parse(storage.getItem(key) ?? "null") as { owner?: string } | null;
    if (current?.owner === owner) storage.removeItem(key);
  } catch {
    // The lease expires on its own when storage is unavailable.
  }
}
