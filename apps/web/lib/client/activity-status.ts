import type { StudySessionDto } from "@/lib/study/types";

export const ACTIVITY_STATUS_EVENT = "areaforge:activity-status";
const ACTIVITY_STATUS_CHANNEL = "areaforge-activity-status-v1";

let channel: BroadcastChannel | null = null;
const sourceId = createSourceId();

export function subscribeActivityStatus(listener: EventListener): () => void {
  if (typeof window === "undefined") return () => undefined;
  ensureChannel();
  window.addEventListener(ACTIVITY_STATUS_EVENT, listener);
  return () => window.removeEventListener(ACTIVITY_STATUS_EVENT, listener);
}

export function publishActivityStatus(userId: string, session: StudySessionDto | null): void {
  if (typeof window === "undefined") return;
  const detail = { userId, session };
  ensureChannel();
  window.dispatchEvent(new CustomEvent(ACTIVITY_STATUS_EVENT, { detail }));
  try {
    channel?.postMessage({ ...detail, sourceId });
  } catch {
    // BroadcastChannel is an enhancement; the current tab still updates.
  }
}

function ensureChannel(): void {
  if (typeof window === "undefined" || channel || typeof BroadcastChannel === "undefined") return;
  try {
    channel = new BroadcastChannel(ACTIVITY_STATUS_CHANNEL);
    channel.addEventListener("message", (event: MessageEvent) => {
      const value = event.data as { userId?: unknown; session?: unknown; sourceId?: unknown } | null;
      if (!value || value.sourceId === sourceId || typeof value.userId !== "string") return;
      window.dispatchEvent(new CustomEvent(ACTIVITY_STATUS_EVENT, {
        detail: {
          userId: value.userId,
          session: isStudySessionDto(value.session) ? value.session : null,
        },
      }));
    });
  } catch {
    channel = null;
  }
}

function isStudySessionDto(value: unknown): value is StudySessionDto {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<StudySessionDto>;
  return typeof session.id === "string"
    && typeof session.subjectId === "string"
    && typeof session.status === "string"
    && typeof session.activityKind === "string";
}

function createSourceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
