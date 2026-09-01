import { postStudySessionCommand, startStudySession } from "@/lib/api/session";
import { isConflict } from "@/lib/client/api-errors";
import { readActiveStudySession } from "@/lib/client/active-study-session";
import { getClientDeviceHeaders } from "@/lib/client/device-identity";
import type { QuickReviewActivityCommand } from "@/lib/client/quick-review-activity";

export async function ensureReviewSession(
  scheduleId: string,
  draftId: string,
  subjectId: string,
): Promise<boolean> {
  const active = await readActiveStudySession();
  if (active) {
    if (active.activityMode !== "KNOWLEDGE_REVIEW" || active.reviewScheduleId !== scheduleId) return false;
    // A persisted review result may still need its configured timer closeout.
    if (active.status === "closing") return true;
    if (active.status === "paused") return Boolean(await postReviewSessionCommand(active, "resume"));
    return true;
  }

  const idempotencyKey = `quick-review-session-${scheduleId}-${draftId}`;
  const result = await startStudySession({
    idempotencyKey,
    subjectId,
    activityKind: "REVIEW",
    activityMode: "KNOWLEDGE_REVIEW",
    reviewScheduleId: scheduleId,
    startSource: "KNOWLEDGE_REVIEW",
  }, getClientDeviceHeaders());
  if (result.ok) return true;
  if (isConflict(result)) {
    const latest = await readActiveStudySession().catch(() => null);
    return Boolean(latest && latest.activityMode === "KNOWLEDGE_REVIEW" && latest.reviewScheduleId === scheduleId);
  }
  return false;
}

export async function resolveReviewSessionAction(
  scheduleId: string,
  action: QuickReviewActivityCommand,
): Promise<boolean> {
  const active = await readActiveStudySession();
  if (!active) return true;
  if (active.activityMode !== "KNOWLEDGE_REVIEW" || active.reviewScheduleId !== scheduleId) return false;
  if (action === "suspend") {
    if (active.status === "paused" || active.status === "closing") return true;
    return Boolean(await postReviewSessionCommand(active, "pause"));
  }
  return Boolean(await postReviewSessionCommand(active, "cancel"));
}

export async function finishReviewSession(scheduleId: string): Promise<boolean> {
  let active = await readActiveStudySession();
  if (!active) return true;
  if (active.activityMode !== "KNOWLEDGE_REVIEW" || active.reviewScheduleId !== scheduleId) return false;
  if (active.status === "running" || active.status === "paused") {
    const prepared = await postReviewSessionCommand(active, "end", { mode: "prepare" });
    if (!prepared) return false;
    active = prepared;
  }
  if (active.status !== "closing") return false;
  return Boolean(await postReviewSessionCommand(active, "end", {
    mode: "complete",
    qualityScore: 3,
    isEffective: true,
    understandingLevel: "基本理解",
    minimalOutput: "快速复习计时完成，结果已记录在复习事件中。",
    nextAction: "继续按复习排期处理下一项",
    producedNote: false,
    producedMistake: false,
    completeTask: false,
    nextDisposition: "复习结果已提交",
  }));
}

async function postReviewSessionCommand(
  session: NonNullable<Awaited<ReturnType<typeof readActiveStudySession>>>,
  endpoint: "pause" | "resume" | "cancel" | "end",
  extra: Record<string, unknown> = {},
): Promise<NonNullable<Awaited<ReturnType<typeof readActiveStudySession>>> | null> {
  const result = await postStudySessionCommand(session.id, endpoint, {
    expectedStatus: session.status,
    expectedUpdatedAt: session.updatedAt,
    idempotencyKey: `quick-review-${session.id}-${endpoint}-${crypto.randomUUID()}`,
    ...extra,
  }, getClientDeviceHeaders());
  const body = result.body;
  if (result.ok && body?.session) return body.session;
  if (isConflict(result)) {
    const latest = await readActiveStudySession().catch(() => null);
    if (endpoint === "pause" && latest?.status === "paused") return latest;
    if (endpoint === "cancel" || endpoint === "end") {
      return !latest ? null : latest.status === "completed" || latest.status === "canceled" ? latest : null;
    }
  }
  return null;
}
