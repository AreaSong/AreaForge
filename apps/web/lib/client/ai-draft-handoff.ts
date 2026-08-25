import { getBrowserStoragePort, type StoragePort } from "@/lib/client/storage-port";

export type AiDraftHandoffEndpoint = "learning-tree" | "knowledge-card";

export interface AiDraftHandoffEnvelope<T> {
  version: 1;
  endpoint: AiDraftHandoffEndpoint;
  userId: string;
  updatedAt: number;
  value: T;
}

export const AI_DRAFT_HANDOFF_EVENT = "areaforge:ai-draft-handoff";
export const AI_DRAFT_HANDOFF_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function aiDraftHandoffKey(endpoint: AiDraftHandoffEndpoint, userId: string): string {
  return `areaforge.ai-draft.${endpoint}.${userId}`;
}

export function writeAiDraftHandoff<T>(
  storage: StoragePort,
  input: { endpoint: AiDraftHandoffEndpoint; userId: string; value: T; now?: number },
): void {
  const envelope: AiDraftHandoffEnvelope<T> = {
    version: 1,
    endpoint: input.endpoint,
    userId: input.userId,
    updatedAt: input.now ?? Date.now(),
    value: input.value,
  };
  storage.setItem(aiDraftHandoffKey(input.endpoint, input.userId), JSON.stringify(envelope));
}

export function readAiDraftHandoff<T>(
  storage: StoragePort,
  input: {
    endpoint: AiDraftHandoffEndpoint;
    userId: string;
    isValue: (value: unknown) => value is T;
    now?: number;
    ttlMs?: number;
  },
): T | null {
  return readAiDraftHandoffEnvelope(storage, input)?.value ?? null;
}

export function readAiDraftHandoffEnvelope<T>(
  storage: StoragePort,
  input: {
    endpoint: AiDraftHandoffEndpoint;
    userId: string;
    isValue: (value: unknown) => value is T;
    now?: number;
    ttlMs?: number;
  },
): AiDraftHandoffEnvelope<T> | null {
  const key = aiDraftHandoffKey(input.endpoint, input.userId);
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? "null") as Partial<AiDraftHandoffEnvelope<unknown>> | null;
    if (
      !parsed
      || parsed.version !== 1
      || parsed.endpoint !== input.endpoint
      || parsed.userId !== input.userId
      || typeof parsed.updatedAt !== "number"
      || (input.now ?? Date.now()) - parsed.updatedAt > (input.ttlMs ?? AI_DRAFT_HANDOFF_TTL_MS)
      || !input.isValue(parsed.value)
    ) {
      storage.removeItem(key);
      return null;
    }
    return parsed as AiDraftHandoffEnvelope<T>;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function publishAiDraftHandoff<T>(input: {
  endpoint: AiDraftHandoffEndpoint;
  userId: string;
  value: T;
}): boolean {
  const storage = getBrowserStoragePort("local");
  if (!storage) return false;
  try {
    writeAiDraftHandoff(storage, input);
    window.dispatchEvent(new CustomEvent(AI_DRAFT_HANDOFF_EVENT, {
      detail: { endpoint: input.endpoint, userId: input.userId },
    }));
    return true;
  } catch {
    return false;
  }
}

export function subscribeAiDraftHandoff<T>(input: {
  endpoint: AiDraftHandoffEndpoint;
  userId: string;
  isValue: (value: unknown) => value is T;
  onValue: (value: T) => void;
}): () => void {
  if (typeof window === "undefined") return () => undefined;
  const receive = (event: Event) => {
    const detail = (event as CustomEvent<{ endpoint?: unknown; userId?: unknown }>).detail;
    if (detail?.endpoint !== input.endpoint || detail.userId !== input.userId) return;
    const storage = getBrowserStoragePort("local");
    if (!storage) return;
    const value = readAiDraftHandoff(storage, input);
    if (value) input.onValue(value);
  };
  window.addEventListener(AI_DRAFT_HANDOFF_EVENT, receive);
  return () => window.removeEventListener(AI_DRAFT_HANDOFF_EVENT, receive);
}
