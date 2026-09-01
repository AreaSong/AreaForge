import { randomUUID } from "node:crypto";
import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import {
  applySessionCas,
  applyTaskCas,
  isUniqueConstraintViolation,
} from "./concurrency";
import { assertSyllabusNodeBelongsToSubject } from "./syllabus-service";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import {
  buildPersistentCreateFingerprint,
  claimPersistentCreateCommand,
  completePersistentCreateClaim,
  normalizeIdempotencyKey,
} from "./persistent-idempotency";
import { assertSuccessorStartAllowed, lockWorkspaceDependencyGraph } from "./task-dependency-service";
import { normalizeDeviceId, normalizeDeviceLabel, serializeSession } from "./session-serializer";
import { getActiveStudySession } from "./session-query-service";
import { getStudySessionStartTimeError } from "./session-time";
import { assertTaskSourceStatus, getTaskCommandPreimage, refreshWorkspaceCheckInsForDates } from "./task-command-support";
import {
  assertActivitySourceBelongsToWorkspace,
  assertSessionCommandExpectation,
  auditSessionCommand,
  getSessionCommandPreimage,
  getUpdatedSessionForResponse,
  isReusedSessionCommand,
  sessionCommandFingerprint,
  sessionConflict,
  validateActivityStart,
} from "./session-command-support";
import type {
  SessionCommandInput,
  StudySessionHeartbeatInput,
  UpdateSessionContextInput,
} from "./study-service-contracts";
import type {
  StudySessionActivityKindDto,
  StudySessionActivityModeDto,
  StudySessionDto,
  StudySessionStartSourceDto,
} from "@/lib/contracts";

type DbStudySessionActivityKind = "STUDY" | "REVIEW" | "TEST";
type DbStudySessionActivityMode = "FREE_STUDY" | "KNOWLEDGE_REVIEW" | "RETEST" | "SIMULATION";



export async function updateStudySessionContext(
  id: string,
  input: UpdateSessionContextInput,
  actorId: string,
): Promise<StudySessionDto> {
  const fingerprint = sessionCommandFingerprint("context", input);
  const session = await prisma.$transaction(async (tx) => {
    const existing = await getSessionCommandPreimage(tx, id, actorId);
    if (await isReusedSessionCommand(tx, id, "STUDY_SESSION_CONTEXT_UPDATED", input.idempotencyKey, fingerprint)) {
      return getUpdatedSessionForResponse(tx, id);
    }
    await assertSessionCommandExpectation(tx, id, existing, input);
    if (!["RUNNING", "PAUSED", "CLOSING"].includes(existing.status)) {
      throw await sessionConflict(tx, id, ["status"]);
    }

    let taskId = existing.taskId;
    if (input.taskId !== undefined) {
      if (input.taskId === null) {
        taskId = null;
      } else {
        const task = await getTaskCommandPreimage(tx, input.taskId, actorId);
        assertTaskSourceStatus(task, ["TODO", "IN_PROGRESS", "DEFERRED"]);
        if (task.subjectId !== existing.subjectId) {
          throw new ApiError("TASK_SUBJECT_MISMATCH", 409, { conflictFields: ["subjectId", "taskId"] });
        }
        taskId = task.id;
      }
    }

    let syllabusNodeId = existing.syllabusNodeId;
    if (input.syllabusNodeId !== undefined) {
      syllabusNodeId = input.syllabusNodeId;
      if (syllabusNodeId) await assertSyllabusNodeBelongsToSubject(syllabusNodeId, existing.subjectId, tx);
    }

    const knowledgePointIds = input.knowledgePointIds === undefined
      ? null
      : Array.from(new Set(input.knowledgePointIds));
    if (knowledgePointIds) {
      const points = await tx.knowledgePoint.findMany({
        where: {
          id: { in: knowledgePointIds },
          workspaceId: (await resolveActiveWorkspace(actorId, tx)).id,
          archivedAt: null,
          OR: [
            { primarySubjectId: existing.subjectId },
            { relatedSubjects: { some: { subjectId: existing.subjectId } } },
          ],
        },
        select: { id: true },
      });
      if (points.length !== knowledgePointIds.length) {
        throw new ApiError("SESSION_KNOWLEDGE_POINT_INVALID", 409, { conflictFields: ["knowledgePointIds"] });
      }
    }

    await applySessionCas(tx, existing, { taskId, syllabusNodeId });
    if (knowledgePointIds) {
      await tx.studySessionKnowledgePoint.deleteMany({ where: { sessionId: id } });
      if (knowledgePointIds.length > 0) {
        await tx.studySessionKnowledgePoint.createMany({
          data: knowledgePointIds.map((knowledgePointId) => ({ sessionId: id, knowledgePointId })),
          skipDuplicates: true,
        });
      }
    }
    await auditSessionCommand(tx, actorId, id, "STUDY_SESSION_CONTEXT_UPDATED", input, "context", fingerprint);
    return getUpdatedSessionForResponse(tx, id);
  });
  return serializeSession(session);
}

export async function startStudySession(
  input: {
    idempotencyKey?: string;
    startedAt?: string;
    subjectId?: string;
    taskId?: string;
    syllabusNodeId?: string | null;
    goalMinutes?: number | null;
    startSource?: StudySessionStartSourceDto;
    activityKind?: StudySessionActivityKindDto;
    activityMode?: StudySessionActivityModeDto;
    reviewScheduleId?: string | null;
    knowledgeRetestId?: string | null;
    simulationExamId?: string | null;
    clientDeviceId?: string;
    clientDeviceLabel?: string;
  },
  actorId: string,
): Promise<StudySessionDto> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey ?? `internal-start-${randomUUID()}`);
  const requestFingerprint = buildPersistentCreateFingerprint("study-session-start-v1", {
    startedAt: input.startedAt ?? null,
    subjectId: input.subjectId ?? null,
    taskId: input.taskId ?? null,
    syllabusNodeId: input.syllabusNodeId ?? null,
    goalMinutes: input.goalMinutes ?? null,
    startSource: input.startSource ?? null,
    activityKind: input.activityKind ?? "STUDY",
    activityMode: input.activityMode ?? "FREE_STUDY",
    reviewScheduleId: input.reviewScheduleId ?? null,
    knowledgeRetestId: input.knowledgeRetestId ?? null,
    simulationExamId: input.simulationExamId ?? null,
    clientDeviceId: normalizeDeviceId(input.clientDeviceId),
  });
  try {
    const session = await prisma.$transaction(async (tx) => {
      const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
      const command = {
        actorId,
        workspaceId: workspace.id,
        action: "STUDY_SESSION_STARTED",
        entityType: "StudySession",
        idempotencyKey,
        requestFingerprint,
        conflictCode: "STUDY_SESSION_START_IDEMPOTENCY_CONFLICT",
      } as const;
      const claim = await claimPersistentCreateCommand(tx, command);
      if (claim.state === "replayed") {
        return getUpdatedSessionForResponse(tx, claim.replay.resultId);
      }
      if (claim.state === "pending") {
        throw new ApiError("STUDY_SESSION_START_IDEMPOTENCY_IN_PROGRESS", 409, {
          conflictFields: ["idempotencyKey"],
        });
      }
      const task = input.taskId ? await getTaskCommandPreimage(tx, input.taskId, actorId) : null;
      if (task) {
        assertTaskSourceStatus(task, ["TODO", "IN_PROGRESS"]);
        if (input.subjectId && input.subjectId !== task.subjectId) {
          throw new ApiError("TASK_SUBJECT_MISMATCH", 409, {
            latest: { taskId: task.id, subjectId: task.subjectId },
            conflictFields: ["subjectId", "taskId"],
        workbench: `/roadmap/allocation/tasks/${task.id}`,
          });
        }
        await lockWorkspaceDependencyGraph(tx, workspace.id);
        await assertSuccessorStartAllowed(task.id, tx);
      }

      const subjectId = task?.subjectId ?? input.subjectId;
      if (!subjectId) {
        throw new ApiError("SUBJECT_REQUIRED", 400);
      }

      const subject = await tx.subject.findFirst({
        where: { id: subjectId, workspaceId: workspace.id },
        select: { id: true, workspaceId: true, archivedAt: true },
      });
      if (!subject) {
        throw new ApiError("SUBJECT_NOT_FOUND", 404);
      }
      if (subject.archivedAt) {
        throw new ApiError("SUBJECT_ARCHIVED", 409);
      }
      const syllabusNodeId = input.syllabusNodeId === undefined
        ? task?.syllabusNodeId ?? null
        : input.syllabusNodeId;
      if (syllabusNodeId) {
        await assertSyllabusNodeBelongsToSubject(syllabusNodeId, subjectId, tx);
      }

      const startSource: StudySessionStartSourceDto =
        input.startSource ?? (task ? "TASK" : "SUBJECT_SHORTCUT");
      const activityKind: DbStudySessionActivityKind = input.activityKind ?? "STUDY";
      const activityMode: DbStudySessionActivityMode = input.activityMode ?? "FREE_STUDY";
      validateActivityStart({
        activityKind,
        activityMode,
        reviewScheduleId: input.reviewScheduleId ?? null,
        knowledgeRetestId: input.knowledgeRetestId ?? null,
        simulationExamId: input.simulationExamId ?? null,
        taskId: task?.id ?? null,
        syllabusNodeId,
      });
      await assertActivitySourceBelongsToWorkspace(tx, actorId, workspace.id, {
        activityMode,
        reviewScheduleId: input.reviewScheduleId ?? null,
        knowledgeRetestId: input.knowledgeRetestId ?? null,
        simulationExamId: input.simulationExamId ?? null,
      });
      const startedAt = input.startedAt ? new Date(input.startedAt) : new Date();
      if (!Number.isFinite(startedAt.getTime())) {
        throw new ApiError("START_TIME_INVALID", 400);
      }
      const startTimeError = getStudySessionStartTimeError(startedAt);
      if (startTimeError === "future") {
        throw new ApiError("START_TIME_IN_FUTURE", 400);
      }
      if (startTimeError === "too_old") {
        throw new ApiError("START_TIME_TOO_OLD", 400);
      }

      const createdSession = await tx.studySession.create({
        data: {
          userId: actorId,
          workspaceId: workspace.id,
          subjectId,
          taskId: task?.id,
          syllabusNodeId,
          activityKind,
          activityMode,
          reviewScheduleId: input.reviewScheduleId ?? null,
          knowledgeRetestId: input.knowledgeRetestId ?? null,
          simulationExamId: input.simulationExamId ?? null,
          status: "RUNNING",
          startedAt,
          goalMinutes: input.goalMinutes ?? null,
          startSource,
          clientDeviceId: normalizeDeviceId(input.clientDeviceId),
          clientDeviceLabel: normalizeDeviceLabel(input.clientDeviceLabel),
          lastHeartbeatAt: new Date(),
        },
        include: {
          subject: true,
          task: true,
          syllabusNode: true,
          closeout: true,
        },
      });

      const deviceId = normalizeDeviceId(input.clientDeviceId);
      const deviceLabel = normalizeDeviceLabel(input.clientDeviceLabel);
      if (deviceId) {
        await tx.studySessionDevicePresence.upsert({
          where: { sessionId_deviceId: { sessionId: createdSession.id, deviceId } },
          create: {
            sessionId: createdSession.id,
            userId: actorId,
            workspaceId: workspace.id,
            deviceId,
            deviceLabel,
            lastSeenAt: new Date(),
          },
          update: { deviceLabel, lastSeenAt: new Date() },
        });
      }

      if (task) {
        await applyTaskCas(tx, task, { status: "IN_PROGRESS" });
        await refreshWorkspaceCheckInsForDates(actorId, [task.plannedDate], tx);
      }

      const responseSession = await getUpdatedSessionForResponse(tx, createdSession.id);
      await completePersistentCreateClaim(
        tx,
        command,
        claim.claimEventId,
        createdSession.id,
        { startSource, subjectId, taskId: task?.id ?? null },
      );
      return responseSession;
    });

    return serializeSession(session);
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      const active = await getActiveStudySession(actorId);
      throw new ApiError("ACTIVE_SESSION_EXISTS", 409, {
        latest: active,
        conflictFields: ["status"],
      });
    }
    throw error;
  }
}

/**
 * Refresh presence without touching updatedAt. Command CAS relies on
 * updatedAt, so a heartbeat must never make a pause or closeout stale.
 */
export async function heartbeatStudySession(
  id: string,
  input: StudySessionHeartbeatInput,
  actorId: string,
): Promise<StudySessionDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const clientDeviceId = normalizeDeviceId(input.clientDeviceId);
  const clientDeviceLabel = normalizeDeviceLabel(input.clientDeviceLabel);
  await prisma.$transaction(async (tx) => {
    const session = await tx.studySession.findFirst({
      where: {
        id,
        userId: actorId,
        workspaceId: workspace.id,
        status: { in: ["RUNNING", "PAUSED", "CLOSING"] },
      },
      select: { clientDeviceId: true },
    });
    if (!session) throw new ApiError("SESSION_NOT_FOUND", 404);

    const now = new Date();
    if (clientDeviceId && (!session.clientDeviceId || session.clientDeviceId === clientDeviceId)) {
      await tx.$executeRaw`
        UPDATE "StudySession"
        SET "clientDeviceId" = ${clientDeviceId},
            "clientDeviceLabel" = ${clientDeviceLabel},
            "lastHeartbeatAt" = ${now}
        WHERE "id" = ${id}
          AND "userId" = ${actorId}
          AND "workspaceId" = ${workspace.id}
          AND "status" IN ('RUNNING', 'PAUSED', 'CLOSING')
      `;
    }
    if (clientDeviceId) {
      await tx.studySessionDevicePresence.upsert({
        where: { sessionId_deviceId: { sessionId: id, deviceId: clientDeviceId } },
        create: {
          sessionId: id,
          userId: actorId,
          workspaceId: workspace.id,
          deviceId: clientDeviceId,
          deviceLabel: clientDeviceLabel,
          lastSeenAt: now,
        },
        update: { deviceLabel: clientDeviceLabel, lastSeenAt: now },
      });
    }
  });

  const latest = await prisma.studySession.findFirst({
    where: { id, userId: actorId, workspaceId: workspace.id },
    include: { subject: true, task: true, syllabusNode: true, closeout: true, devicePresences: true, knowledgeLinks: { include: { knowledgePoint: { select: { id: true, title: true, masteryState: true } } }, orderBy: { createdAt: "asc" } } },
  });
  if (!latest) throw new ApiError("SESSION_NOT_FOUND", 404);
  return serializeSession(latest);
}

export async function pauseStudySession(id: string, actorId: string, input?: SessionCommandInput): Promise<StudySessionDto> {
  const session = await prisma.$transaction(async (tx) => {
    const existing = await getSessionCommandPreimage(tx, id, actorId);
    if (input && await isReusedSessionCommand(tx, id, "STUDY_SESSION_PAUSED", input.idempotencyKey, sessionCommandFingerprint("pause", input))) {
      return getUpdatedSessionForResponse(tx, id);
    }
    await assertSessionCommandExpectation(tx, id, existing, input);
    if (!existing || existing.status !== "RUNNING") {
      throw await sessionConflict(tx, id, ["status"]);
    }

    await applySessionCas(tx, existing, {
      status: "PAUSED",
      pausedAt: new Date(),
    });
    await auditSessionCommand(tx, actorId, id, "STUDY_SESSION_PAUSED", input, "pause");

    return getUpdatedSessionForResponse(tx, id);
  });

  return serializeSession(session);
}

export async function resumeStudySession(id: string, actorId: string, input?: SessionCommandInput): Promise<StudySessionDto> {
  const session = await prisma.$transaction(async (tx) => {
    const existing = await getSessionCommandPreimage(tx, id, actorId);
    if (input && await isReusedSessionCommand(tx, id, "STUDY_SESSION_RESUMED", input.idempotencyKey, sessionCommandFingerprint("resume", input))) {
      return getUpdatedSessionForResponse(tx, id);
    }
    await assertSessionCommandExpectation(tx, id, existing, input);
    if (!existing || !["PAUSED", "CLOSING"].includes(existing.status)) {
      throw await sessionConflict(tx, id, ["status"]);
    }

    const now = new Date();
    const pauseOrigin = existing.status === "PAUSED" ? existing.pausedAt : existing.endedAt;
    const extraPauseSeconds = pauseOrigin ? Math.max(0, Math.floor((now.getTime() - pauseOrigin.getTime()) / 1000)) : 0;
    await applySessionCas(tx, existing, {
      status: "RUNNING",
      pausedAt: null,
      endedAt: null,
      accumulatedPauseSeconds: existing.accumulatedPauseSeconds + extraPauseSeconds,
    });
    await auditSessionCommand(tx, actorId, id, "STUDY_SESSION_RESUMED", input, "resume");

    return getUpdatedSessionForResponse(tx, id);
  });

  return serializeSession(session);
}

/**
 * Cancel an activity that was started by mistake. Cancellation deliberately
 * keeps the session row and audit trail, but it must never create a learning
 * or check-in fact.
 */
export async function cancelStudySession(
  id: string,
  actorId: string,
  input?: SessionCommandInput,
): Promise<StudySessionDto> {
  const session = await prisma.$transaction(async (tx) => {
    const existing = await getSessionCommandPreimage(tx, id, actorId);
    const fingerprint = input ? sessionCommandFingerprint("cancel", input) : undefined;
    if (input && await isReusedSessionCommand(tx, id, "STUDY_SESSION_CANCELED", input.idempotencyKey, fingerprint!)) {
      return getUpdatedSessionForResponse(tx, id);
    }
    await assertSessionCommandExpectation(tx, id, existing, input);
    if (!["RUNNING", "PAUSED", "CLOSING"].includes(existing.status)) {
      throw await sessionConflict(tx, id, ["status"]);
    }
    await applySessionCas(tx, existing, {
      status: "CANCELED",
      endedAt: new Date(),
      pausedAt: null,
    });
    await tx.studySessionDevicePresence.deleteMany({ where: { sessionId: id } });
    await auditSessionCommand(tx, actorId, id, "STUDY_SESSION_CANCELED", input, "cancel", fingerprint);
    return getUpdatedSessionForResponse(tx, id);
  });
  return serializeSession(session);
}
