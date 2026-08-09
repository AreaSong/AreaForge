import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";

export type AiAssistantEndpoint = "learning-tree" | "knowledge-card" | "plan" | "motivation";

export interface PersistedAiAssistantContext {
  contextKey: string;
  endpoint: AiAssistantEndpoint;
  items: Array<{ id: string; label: string; text: string }>;
}

export function loadAiAssistantContext(userId: string): PersistedAiAssistantContext | null {
  return loadPrivateBusinessDraft(
    getAiAssistantContextStorageKey(userId),
    LONG_PRIVATE_DRAFT_TTL_MS,
    isPersistedAiAssistantContext,
  );
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

export function isPersistedAiAssistantContext(value: unknown): value is PersistedAiAssistantContext {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedAiAssistantContext>;
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
  return candidate.items.every((item) => Boolean(
    item
    && typeof item.id === "string"
    && item.id.length > 0
    && item.id.length <= 256
    && typeof item.label === "string"
    && item.label.length <= 256
    && typeof item.text === "string"
    && item.text.length > 0
    && item.text.length <= 3_000,
  ));
}

function isAiAssistantEndpoint(value: unknown): value is AiAssistantEndpoint {
  return value === "learning-tree" || value === "knowledge-card" || value === "plan" || value === "motivation";
}
