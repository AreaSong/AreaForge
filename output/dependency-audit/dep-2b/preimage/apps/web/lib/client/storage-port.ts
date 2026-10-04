export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface EnumerableStoragePort extends StoragePort {
  readonly length: number;
  key(index: number): string | null;
}

export type BrowserStorageKind = "local" | "session";

/**
 * Resolve a browser storage backend at the boundary where browser APIs are
 * allowed.  Private browsing, blocked cookies, and SSR all produce `null` so
 * callers can choose an explicit in-memory or no-op fallback.
 */
export function getBrowserStoragePort(kind: BrowserStorageKind): EnumerableStoragePort | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function getBrowserStoragePortOrMemory(kind: BrowserStorageKind): EnumerableStoragePort {
  return getBrowserStoragePort(kind) ?? createMemoryStoragePort();
}

export function readBrowserStorageItem(kind: BrowserStorageKind, key: string): string | null {
  try {
    return getBrowserStoragePort(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeBrowserStorageItem(kind: BrowserStorageKind, key: string, value: string): boolean {
  try {
    const storage = getBrowserStoragePort(kind);
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function listStorageKeys(storage: EnumerableStoragePort): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null) keys.push(key);
  }
  return keys;
}

export function createMemoryStoragePort(
  entries: Iterable<readonly [string, string]> = [],
): EnumerableStoragePort {
  const values = new Map(entries);

  return {
    get length() {
      return values.size;
    },
    key(index) {
      if (!Number.isInteger(index) || index < 0) return null;
      return Array.from(values.keys())[index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}
