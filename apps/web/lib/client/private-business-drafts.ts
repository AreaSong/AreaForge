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

interface PrivateDraftEnvelope<T> {
  version: 1;
  updatedAt: number;
  value: T;
}

export function savePrivateBusinessDraft<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    const envelope: PrivateDraftEnvelope<T> = { version: 1, updatedAt: Date.now(), value };
    window.localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Storage can be unavailable or full. The form state remains in memory.
  }
}

export function loadPrivateBusinessDraft<T>(
  key: string,
  ttlMs: number,
  isValue: (value: unknown) => value is T,
): T | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null") as Partial<PrivateDraftEnvelope<unknown>> | null;
    if (!parsed || parsed.version !== 1 || typeof parsed.updatedAt !== "number" || !isValue(parsed.value)) {
      return null;
    }
    if (Date.now() - parsed.updatedAt > ttlMs) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed.value;
  } catch {
    removePrivateBusinessDraft(key);
    return null;
  }
}

export function removePrivateBusinessDraft(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable. There is no further recovery action here.
  }
}

export function redirectToLoginWithCurrentLocation(): void {
  if (typeof window === "undefined") return;
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

export function clearPrivateBusinessDrafts() {
  if (typeof window === "undefined") return;
  clearMatchingKeys(window.localStorage);
  clearMatchingKeys(window.sessionStorage);
}

function clearMatchingKeys(storage: Storage) {
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
