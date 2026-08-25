import { createDraftStore, type LoadedDraft } from "@/lib/client/draft-store";
import { getBrowserStoragePort, type EnumerableStoragePort, type StoragePort } from "@/lib/client/storage-port";

export const PRIVATE_BUSINESS_DRAFT_PREFIXES = [
  "areaforge.command.",
  "areaforge.quick-review.",
  "areaforge.focus.closeout.",
  "areaforge.daily-review.draft.",
  "areaforge.task.draft.",
  "areaforge.note.draft.",
  "areaforge.mistake.draft.",
  "areaforge.resource.draft.",
  "areaforge.plan-inbox.draft.",
  "areaforge.ai-draft.",
  "areaforge.learning-tree-import.",
  "areaforge.syllabus.draft.",
  "areaforge.motivation-vault.draft.",
  "areaforge.motivation-library.draft.",
  "areaforge.notification-preference.draft.",
  "areaforge.simulation.draft.",
  "areaforge.workspace-setup.draft.",
  "areaforge.workspace-edit.draft.",
] as const;

export const SHORT_PRIVATE_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export const LONG_PRIVATE_DRAFT_TTL_MS = 7 * SHORT_PRIVATE_DRAFT_TTL_MS;

export function savePrivateBusinessDraft<T>(key: string, value: T): void {
  const storage = browserStorage("local");
  if (!storage) return;
  createDraftStore(storage).save(key, value);
}

export function loadPrivateBusinessDraft<T>(
  key: string,
  ttlMs: number,
  isValue: (value: unknown) => value is T,
): T | null {
  const storage = browserStorage("local");
  return storage ? createDraftStore(storage).load(key, { ttlMs, isValue }) : null;
}

export function loadPrivateBusinessDraftEnvelope<T>(
  key: string,
  ttlMs: number,
  isValue: (value: unknown) => value is T,
): LoadedDraft<T> | null {
  const storage = browserStorage("local");
  return storage ? createDraftStore(storage).loadEnvelope(key, { ttlMs, isValue }) : null;
}

export function removePrivateBusinessDraft(key: string): void {
  const storage = browserStorage("local");
  if (storage) createDraftStore(storage).remove(key);
}

export function redirectToLoginWithCurrentLocation(): void {
  if (typeof window === "undefined") return;
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

export function clearPrivateBusinessDrafts() {
  clearMatchingKeys(getBrowserStoragePort("local"));
  clearMatchingKeys(getBrowserStoragePort("session"));
}

function clearMatchingKeys(storage: EnumerableStoragePort | null) {
  if (!storage) return;
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
      (key): key is string => Boolean(key),
    );
    for (const key of keys) {
      if (PRIVATE_BUSINESS_DRAFT_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        storage.removeItem(key);
      }
    }
  } catch {
    // A failed storage backend must not prevent a successful logout.
  }
}

function browserStorage(kind: "local" | "session"): StoragePort | null {
  return getBrowserStoragePort(kind);
}
