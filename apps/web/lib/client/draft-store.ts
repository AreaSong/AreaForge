import type { StoragePort } from "@/lib/client/storage-port";

export interface DraftEnvelope<T> {
  version: 1;
  updatedAt: number;
  value: T;
}

export interface DraftStoreOptions<T> {
  ttlMs: number;
  isValue: (value: unknown) => value is T;
  now?: () => number;
}

export type LoadedDraft<T> = Pick<DraftEnvelope<T>, "updatedAt" | "value">;

export function isDraftAtLeastAsNew(
  candidate: Pick<DraftEnvelope<unknown>, "updatedAt">,
  baseline: Pick<DraftEnvelope<unknown>, "updatedAt"> | null,
): boolean {
  return baseline === null || candidate.updatedAt >= baseline.updatedAt;
}

/**
 * 纯草稿存储控制器：只处理 envelope、TTL 和校验，不决定领域草稿的清理时机。
 * 浏览器 localStorage/sessionStorage 通过 StoragePort 注入，测试和其他客户端可复用同一规则。
 */
export function createDraftStore(storage: StoragePort) {
  function loadEnvelope<T>(key: string, options: DraftStoreOptions<T>): LoadedDraft<T> | null {
    const now = options.now ?? Date.now;
    try {
      const parsed = JSON.parse(storage.getItem(key) ?? "null") as Partial<DraftEnvelope<unknown>> | null;
      if (!parsed || parsed.version !== 1 || typeof parsed.updatedAt !== "number" || !options.isValue(parsed.value)) {
        return null;
      }
      if (now() - parsed.updatedAt > options.ttlMs) {
        storage.removeItem(key);
        return null;
      }
      return { updatedAt: parsed.updatedAt, value: parsed.value };
    } catch {
      try {
        storage.removeItem(key);
      } catch {
        // 存储后端不可用时不阻断页面流程。
      }
      return null;
    }
  }

  return {
    save<T>(key: string, value: T, now = Date.now()): void {
      try {
        const envelope: DraftEnvelope<T> = { version: 1, updatedAt: now, value };
        storage.setItem(key, JSON.stringify(envelope));
      } catch {
        // 存储不可用或空间不足时，调用方仍保留内存态。
      }
    },

    load<T>(key: string, options: DraftStoreOptions<T>): T | null {
      return loadEnvelope(key, options)?.value ?? null;
    },

    loadEnvelope,

    remove(key: string): void {
      try {
        storage.removeItem(key);
      } catch {
        // 清理失败不应阻断成功的业务写入。
      }
    },
  };
}

export type DraftStore = ReturnType<typeof createDraftStore>;
