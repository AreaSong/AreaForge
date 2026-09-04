import { type Prisma } from "@areaforge/db";
import { createHash } from "node:crypto";
import { ApiError } from "@/lib/api/responses";
import { resolveActiveWorkspace } from "./exam-workspace-service";
import { serializeSession } from "./session-serializer";
import { audit } from "./study-audit";
import type {
  LinkSessionEvidenceInput,
  SessionCommandInput,
} from "./study-service-contracts";
import type {
  StudySessionEvidenceReceiptDto,
  StudySessionEvidenceTypeDto,
} from "@/lib/contracts";


export type DbStudySessionStatus = "RUNNING" | "PAUSED" | "CLOSING" | "COMPLETED" | "CANCELED";
export type DbStudySessionActivityKind = "STUDY" | "REVIEW" | "TEST";
export type DbStudySessionActivityMode = "FREE_STUDY" | "KNOWLEDGE_REVIEW" | "RETEST" | "SIMULATION";

export function toCloseoutUnderstanding(value: string | undefined, qualityScore: number): "NO_PROGRESS" | "SOME_PROGRESS" | "UNDERSTOOD" | "CAN_APPLY" {
  if (value === "清晰") return "CAN_APPLY";
  if (value === "基本理解") return "UNDERSTOOD";
  if (value === "模糊") return "SOME_PROGRESS";
  if (value) return "NO_PROGRESS";
  if (qualityScore >= 4) return "UNDERSTOOD";
  if (qualityScore >= 2) return "SOME_PROGRESS";
  return "NO_PROGRESS";
}

export function toCloseoutEfficiency(isEffective: boolean, qualityScore?: number): "LOW" | "NORMAL" | "HIGH" {
  if (!isEffective) return "LOW";
  return (qualityScore ?? 3) >= 4 ? "HIGH" : "NORMAL";
}

export async function validateSessionEvidence(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  session: { subjectId: string; taskId: string | null; syllabusNodeId: string | null },
  input: LinkSessionEvidenceInput,
): Promise<StudySessionEvidenceReceiptDto> {
  if (input.evidenceType === "note") {
    const note = await tx.note.findFirst({
      where: { id: input.evidenceId, subject: { workspaceId } },
      select: { id: true, title: true, subjectId: true, taskId: true, syllabusNodeId: true },
    });
    if (!note) throw new ApiError("NOTE_NOT_FOUND", 404);
    assertSessionEvidenceContext(session, note);
    return { evidenceType: "note", evidenceId: note.id, label: note.title };
  }
  if (input.evidenceType === "mistake") {
    const mistake = await tx.mistake.findFirst({
      where: { id: input.evidenceId, subject: { workspaceId } },
      select: { id: true, title: true, subjectId: true, syllabusNodeId: true },
    });
    if (!mistake) throw new ApiError("MISTAKE_NOT_FOUND", 404);
    assertSessionEvidenceContext(session, mistake);
    return { evidenceType: "mistake", evidenceId: mistake.id, label: mistake.title };
  }
  if (!session.syllabusNodeId) {
    throw new ApiError("SESSION_RETEST_REQUIRES_SYLLABUS_NODE", 409, { conflictFields: ["syllabusNodeId"] });
  }
  const retest = await tx.masteryRetest.findFirst({
    where: { id: input.evidenceId, syllabusNode: { subject: { workspaceId } } },
    select: { id: true, result: true, syllabusNodeId: true },
  });
  if (!retest) throw new ApiError("MASTERY_RETEST_NOT_FOUND", 404);
  if (retest.syllabusNodeId !== session.syllabusNodeId) {
    throw new ApiError("SESSION_EVIDENCE_CONTEXT_MISMATCH", 409, { conflictFields: ["syllabusNodeId"] });
  }
  return {
    evidenceType: "retest",
    evidenceId: retest.id,
    label: `复测${retest.result === "passed" ? "通过" : retest.result === "partial" ? "部分通过" : "未通过"}`,
  };
}

export function assertSessionEvidenceContext(
  session: { subjectId: string; taskId: string | null; syllabusNodeId: string | null },
  evidence: { subjectId: string; taskId?: string | null; syllabusNodeId: string | null },
): void {
  const conflictFields: string[] = [];
  if (evidence.subjectId !== session.subjectId) conflictFields.push("subjectId");
  if (session.syllabusNodeId && evidence.syllabusNodeId !== session.syllabusNodeId) conflictFields.push("syllabusNodeId");
  if ("taskId" in evidence && session.taskId && evidence.taskId !== session.taskId) conflictFields.push("taskId");
  if (conflictFields.length > 0) {
    throw new ApiError("SESSION_EVIDENCE_CONTEXT_MISMATCH", 409, { conflictFields });
  }
}

export function sessionEvidenceTypeLabel(value: StudySessionEvidenceTypeDto): string {
  if (value === "note") return "知识卡片";
  if (value === "mistake") return "错题";
  return "复测";
}

export function validateActivityStart(input: {
  activityKind: DbStudySessionActivityKind;
  activityMode: DbStudySessionActivityMode;
  reviewScheduleId: string | null;
  knowledgeRetestId: string | null;
  simulationExamId: string | null;
  taskId: string | null;
  syllabusNodeId: string | null;
}): void {
  const sourceCount = [input.reviewScheduleId, input.knowledgeRetestId, input.simulationExamId].filter(Boolean).length;
  if (input.activityMode === "FREE_STUDY") {
    if (input.activityKind !== "STUDY" || sourceCount > 0) {
      throw new ApiError("ACTIVITY_SOURCE_INVALID", 400, { conflictFields: ["activityKind", "activityMode"] });
    }
    return;
  }
  if (input.taskId || input.syllabusNodeId) {
    throw new ApiError("ACTIVITY_CONTEXT_MUST_BE_PRECONFIGURED", 400, { conflictFields: ["taskId", "syllabusNodeId"] });
  }
  if (sourceCount !== 1) {
    throw new ApiError("ACTIVITY_SOURCE_REQUIRED", 400, { conflictFields: ["reviewScheduleId", "knowledgeRetestId", "simulationExamId"] });
  }
  const expectedKind = input.activityMode === "KNOWLEDGE_REVIEW" || input.activityMode === "RETEST"
    ? "REVIEW"
    : "TEST";
  if (input.activityKind !== expectedKind) {
    throw new ApiError("ACTIVITY_KIND_MODE_MISMATCH", 400, { conflictFields: ["activityKind", "activityMode"] });
  }
  if (input.activityMode === "KNOWLEDGE_REVIEW" && !input.reviewScheduleId) {
    throw new ApiError("REVIEW_SCHEDULE_REQUIRED", 400, { conflictFields: ["reviewScheduleId"] });
  }
  if (input.activityMode === "RETEST" && !input.knowledgeRetestId) {
    throw new ApiError("KNOWLEDGE_RETEST_REQUIRED", 400, { conflictFields: ["knowledgeRetestId"] });
  }
  if (input.activityMode === "SIMULATION" && !input.simulationExamId) {
    throw new ApiError("SIMULATION_EXAM_REQUIRED", 400, { conflictFields: ["simulationExamId"] });
  }
}

export async function assertActivitySourceBelongsToWorkspace(
  tx: Prisma.TransactionClient,
  actorId: string,
  workspaceId: string,
  input: {
    activityMode: DbStudySessionActivityMode;
    reviewScheduleId: string | null;
    knowledgeRetestId: string | null;
    simulationExamId: string | null;
  },
): Promise<void> {
  if (input.activityMode === "FREE_STUDY") return;
  if (input.activityMode === "KNOWLEDGE_REVIEW") {
    const schedule = await tx.reviewSchedule.findFirst({
      where: { id: input.reviewScheduleId ?? "", workspaceId, OR: [{ actorId: null }, { actorId }] },
      select: { id: true },
    });
    if (!schedule) throw new ApiError("REVIEW_SCHEDULE_NOT_FOUND", 404);
    return;
  }
  if (input.activityMode === "RETEST") {
    const retest = await tx.knowledgeRetest.findFirst({
      where: { id: input.knowledgeRetestId ?? "", userId: actorId, workspaceId },
      select: { id: true, status: true },
    });
    if (!retest) throw new ApiError("KNOWLEDGE_RETEST_NOT_FOUND", 404);
    if (retest.status !== "DRAFT" && retest.status !== "IN_PROGRESS") {
      throw new ApiError("KNOWLEDGE_RETEST_START_INVALID_STATE", 409, { conflictFields: ["status"] });
    }
    return;
  }
  const exam = await tx.simulationExam.findFirst({
    where: { id: input.simulationExamId ?? "", workspaceId },
    select: { id: true, status: true },
  });
  if (!exam) throw new ApiError("SIMULATION_EXAM_NOT_FOUND", 404);
  if (exam.status !== "DRAFT" && exam.status !== "IN_PROGRESS") {
    throw new ApiError("SIMULATION_EXAM_START_INVALID_STATE", 409, { conflictFields: ["status"] });
  }
}

export async function getUpdatedSessionForResponse(tx: Prisma.TransactionClient, id: string) {
  const session = await tx.studySession.findUnique({
    where: { id },
    include: {
      subject: true,
      task: true,
      syllabusNode: true,
      closeout: true,
      devicePresences: true,
      knowledgeLinks: { include: { knowledgePoint: { select: { id: true, title: true, masteryState: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!session) throw new ApiError("SESSION_STATE_CONFLICT", 409);
  return session;
}

export async function getSessionCommandPreimage(
  tx: Prisma.TransactionClient,
  id: string,
  actorId: string,
) {
  const workspace = await resolveActiveWorkspace(actorId, tx);
  const session = await tx.studySession.findFirst({
    where: { id, userId: actorId, workspaceId: workspace.id, subject: { workspaceId: workspace.id } },
  });
  if (!session) throw new ApiError("SESSION_NOT_FOUND", 404);
  return session;
}

export async function assertSessionCommandExpectation(
  tx: Prisma.TransactionClient,
  id: string,
  existing: { status: DbStudySessionStatus; updatedAt: Date },
  input?: SessionCommandInput,
): Promise<void> {
  if (!input) return;
  const expectedStatus = input.expectedStatus.toUpperCase() as DbStudySessionStatus;
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  const conflictFields: string[] = [];
  if (existing.status !== expectedStatus) conflictFields.push("status");
  if (!Number.isFinite(expectedUpdatedAt.getTime()) || existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) conflictFields.push("updatedAt");
  if (conflictFields.length) throw await sessionConflict(tx, id, conflictFields);
}

export async function sessionConflict(tx: Prisma.TransactionClient, id: string, conflictFields: string[]): Promise<ApiError> {
  const latest = await getUpdatedSessionForResponse(tx, id);
  return new ApiError("SESSION_STATE_CONFLICT", 409, { latest: serializeSession(latest), conflictFields });
}

export function sessionCommandFingerprint(action: string, input: object): string {
  return createHash("sha256").update(JSON.stringify({ action, input })).digest("hex");
}

export async function isReusedSessionCommand(
  tx: Prisma.TransactionClient,
  sessionId: string,
  action: string,
  idempotencyKey: string,
  requestFingerprint: string,
): Promise<boolean> {
  const existing = await tx.auditEvent.findFirst({
    where: {
      action,
      entityType: "StudySession",
      entityId: sessionId,
      metadata: { path: ["idempotencyKey"], equals: idempotencyKey },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!existing) return false;
  const metadata = typeof existing.metadata === "object" && existing.metadata && !Array.isArray(existing.metadata)
    ? existing.metadata as Record<string, unknown>
    : {};
  if (metadata.requestFingerprint !== requestFingerprint) {
    throw new ApiError("SESSION_IDEMPOTENCY_CONFLICT", 409, {
      conflictFields: ["idempotencyKey"],
    });
  }
  return true;
}

export async function auditSessionCommand(
  tx: Prisma.TransactionClient,
  actorId: string,
  sessionId: string,
  action: string,
  input: SessionCommandInput | undefined,
  fingerprintAction: string,
  requestFingerprint?: string,
): Promise<void> {
  if (!input) {
    await audit(actorId, action, "StudySession", sessionId, tx);
    return;
  }
  await tx.auditEvent.create({
    data: {
      actorId,
      action,
      entityType: "StudySession",
      entityId: sessionId,
      metadata: {
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: requestFingerprint ?? sessionCommandFingerprint(fingerprintAction, input),
        expectedStatus: input.expectedStatus,
        expectedUpdatedAt: input.expectedUpdatedAt,
      },
    },
  });
}
