import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import {
  createAiSelectionItem,
  type PersistedAiSelectionItem,
} from "@/lib/client/ai-assistant-selection";

export type AiAssistantEndpoint = "learning-tree" | "knowledge-card" | "plan" | "motivation";

export interface PersistedAiAssistantContext {
  schemaVersion: 2;
  contextKey: string;
  endpoint: AiAssistantEndpoint;
  items: PersistedAiSelectionItem[];
}

interface LegacyAiAssistantContext {
  contextKey: string;
  endpoint: AiAssistantEndpoint;
  items: Array<{ id: string; label: string; text: string }>;
}

type StoredAiAssistantContext = PersistedAiAssistantContext | LegacyAiAssistantContext;

export function loadAiAssistantContext(userId: string): PersistedAiAssistantContext | null {
  const stored = loadPrivateBusinessDraft(
    getAiAssistantContextStorageKey(userId),
    LONG_PRIVATE_DRAFT_TTL_MS,
    isPersistedAiAssistantContext,
  );
  return stored ? normalizeAiAssistantContext(stored) : null;
}

export function saveAiAssistantContext(userId: string, value: PersistedAiAssistantContext): void {
  savePrivateBusinessDraft(getAiAssistantContextStorageKey(userId), value);
}

export function removeAiAssistantContext(userId: string): void {
  removePrivateBusinessDraft(getAiAssistantContextStorageKey(userId));
}

export function getAiAssistantContextStorageKey(userId: string): string {
  return `areaforge.ai-draft.assistant.${userId}`;
}

export function isPersistedAiAssistantContext(value: unknown): value is StoredAiAssistantContext {
  if (!value || typeof value !== "object") return false;
  const candidate = value as {
    schemaVersion?: unknown;
    contextKey?: unknown;
    endpoint?: unknown;
    items?: unknown[];
  };
  if (
    typeof candidate.contextKey !== "string"
    || candidate.contextKey.length === 0
    || candidate.contextKey.length > 2_048
    || !isAiAssistantEndpoint(candidate.endpoint)
    || !Array.isArray(candidate.items)
    || candidate.items.length > 32
  ) {
    return false;
  }
  if (candidate.schemaVersion === 2) {
    const identities = new Set<string>();
    const fingerprints = new Set<string>();
    return candidate.items.every((item) => {
      if (!isPersistedSelection(item)) return false;
      if (identities.has(item.identity) || fingerprints.has(item.fingerprint)) return false;
      identities.add(item.identity);
      fingerprints.add(item.fingerprint);
      return true;
    });
  }
  return candidate.items.every(isLegacySelection);
}

export function normalizeAiAssistantContext(value: unknown): PersistedAiAssistantContext | null {
  if (!isPersistedAiAssistantContext(value)) return null;
  const stored = value;
  if ("schemaVersion" in stored && stored.schemaVersion === 2) return stored;
  const legacy = stored as LegacyAiAssistantContext;
  const fingerprints = new Set<string>();
  const items: PersistedAiSelectionItem[] = [];
  legacy.items.forEach((item, index) => {
    const normalized = createAiSelectionItem({
      kind: "legacy",
      source: item.id,
      label: item.label,
      text: item.text,
      rect: null,
    }, () => `legacy-${index}-${item.id}`);
    if (fingerprints.has(normalized.fingerprint)) return;
    fingerprints.add(normalized.fingerprint);
    items.push({
      identity: normalized.identity,
      fingerprint: normalized.fingerprint,
      label: normalized.label,
      text: normalized.text,
    });
  });
  return { schemaVersion: 2, contextKey: legacy.contextKey, endpoint: legacy.endpoint, items };
}

function isPersistedSelection(item: unknown): item is PersistedAiSelectionItem {
  if (!isSelectionText(item)) return false;
  return typeof item.identity === "string"
    && item.identity.length > 0
    && item.identity.length <= 256
    && typeof item.fingerprint === "string"
    && item.fingerprint.length > 0
    && item.fingerprint.length <= 8_192;
}

function isLegacySelection(
  item: unknown,
): item is LegacyAiAssistantContext["items"][number] {
  if (!isSelectionText(item)) return false;
  return typeof item.id === "string" && item.id.length > 0 && item.id.length <= 256;
}

function isSelectionText(item: unknown): item is Record<string, unknown> {
  if (!item || typeof item !== "object") return false;
  const record = item as Record<string, unknown>;
  return typeof record.label === "string"
    && record.label.length <= 256
    && typeof record.text === "string"
    && record.text.length > 0
    && record.text.length <= 3_000;
}

function isAiAssistantEndpoint(value: unknown): value is AiAssistantEndpoint {
  return value === "learning-tree" || value === "knowledge-card" || value === "plan" || value === "motivation";
}
