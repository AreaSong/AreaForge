import { getTimerElapsedSeconds, normalizeStudyCloseout } from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getStudyDayRange } from "./date";
import { applySessionCas, applyTaskCas } from "./concurrency";
import { createTaskDebtEvent } from "./task-debt-event-service";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import { applyRecoveryV2CheckInProgressInTx } from "./recovery-v2-service";
import {
  buildPersistentCreateFingerprint,
  findPersistentCreateReplay,
  normalizeIdempotencyKey,
  recordPersistentCreateResult,
  type PersistentCreateCommand,
} from "./persistent-idempotency";
import { parseSessionEvidenceReceipt } from "./session-evidence-contract";
import { serializeSession } from "./session-serializer";
import { assertTaskSourceStatus, getTaskCommandPreimage, refreshWorkspaceCheckInsForDates, toTaskDebtEventState } from "./task-command-support";
import {
  auditSessionCommand,
  assertSessionCommandExpectation,
  getSessionCommandPreimage,
  getUpdatedSessionForResponse,
  isReusedSessionCommand,
  sessionCommandFingerprint,
  sessionConflict,
  sessionEvidenceTypeLabel,
  toCloseoutEfficiency,
  toCloseoutUnderstanding,
  validateSessionEvidence,
} from "./session-command-support";
import type { EndSessionInput, LinkSessionEvidenceInput } from "./study-service-contracts";
import type { StudySessionDto, StudySessionEvidenceReceiptDto } from "@/lib/contracts";
import type { DbStudySessionActivityMode } from "./session-command-support";

/**
 * Completes a configured review/test timer after its source page has collected
 * the activity-specific result and feedback. The timer must already be in
 * CLOSING; this keeps the timer fact separate from the business result while
 * still closing both in the same source-page transaction.
 */
export async function completeConfiguredActivitySessionInTx(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    workspaceId: string;
    sessionId: string;
    activityMode: Extract<DbStudySessionActivityMode, "KNOWLEDGE_REVIEW" | "RETEST" | "SIMULATION">;
    minimalOutput: string;
    nextAction: string;
  },
): Promise<void> {
  const existing = await tx.studySession.findFirst({
    where: {
      id: input.sessionId,
      userId: input.actorId,
      workspaceId: input.workspaceId,
      activityMode: input.activityMode,
      status: { in: ["RUNNING", "PAUSED", "CLOSING"] },
    },
    select: {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
      accumulatedPauseSeconds: true,
      updatedAt: true,
    },
  });
  if (!existing) {
    const alreadyCompleted = await tx.studySession.findFirst({
      where: {
        id: input.sessionId,
        userId: input.actorId,
        workspaceId: input.workspaceId,
        activityMode: input.activityMode,
        status: "COMPLETED",
      },
      select: { id: true },
    });
    if (alreadyCompleted) return;
    throw new ApiError("ACTIVITY_SESSION_NOT_FOUND", 404);
  }
  if (existing.status !== "CLOSING") {
    throw new ApiError("ACTIVITY_TIMER_NOT_CLOSED", 409, { conflictFields: ["status"] });
  }

  const now = new Date();
  const endedAt = existing.endedAt ?? now;
  const effectiveSeconds = getTimerElapsedSeconds({
    status: "completed",
    startedAt: existing.startedAt,
    endedAt,
    accumulatedPauseSeconds: existing.accumulatedPauseSeconds,
  });
  const effectiveMinutes = Math.max(0, Math.floor(effectiveSeconds / 60));
  const changed = await tx.studySession.updateMany({
    where: {
      id: existing.id,
      userId: input.actorId,
      workspaceId: input.workspaceId,
      status: "CLOSING",
      updatedAt: existing.updatedAt,
    },
    data: {
      status: "COMPLETED",
      endedAt,
      pausedAt: null,
      effectiveMinutes,
      isEffective: true,
      understandingLevel: "SPECIAL_ACTIVITY",
      minimalOutput: input.minimalOutput.trim().slice(0, 1000),
      nextAction: input.nextAction.trim().slice(0, 500),
      isLowConversion: false,
      closeoutVersion: { increment: 1 },
    },
  });
  if (changed.count !== 1) {
    throw new ApiError("ACTIVITY_SESSION_REVISION_CONFLICT", 409, { conflictFields: ["status", "updatedAt"] });
  }

  await tx.studySessionCloseout.upsert({
    where: { sessionId: existing.id },
    update: {
      understanding: "UNDERSTOOD",
      efficiency: "NORMAL",
      lowReasons: [],
      summary: input.minimalOutput.trim().slice(0, 2000),
      nextDisposition: input.nextAction.trim().slice(0, 500),
      revision: { increment: 1 },
      submittedAt: now,
      actorId: input.actorId,
    },
    create: {
      sessionId: existing.id,
      understanding: "UNDERSTOOD",
      efficiency: "NORMAL",
      lowReasons: [],
      summary: input.minimalOutput.trim().slice(0, 2000),
      nextDisposition: input.nextAction.trim().slice(0, 500),
      actorId: input.actorId,
      submittedAt: now,
    },
  });
  await tx.studySessionDevicePresence.deleteMany({ where: { sessionId: existing.id } });
  await tx.auditEvent.create({
    data: {
      actorId: input.actorId,
      action: `STUDY_ACTIVITY_${input.activityMode}_COMPLETED`,
      entityType: "StudySession",
      entityId: existing.id,
      metadata: { activityMode: input.activityMode, effectiveMinutes } as Prisma.InputJsonValue,
    },
  });
  await refreshWorkspaceCheckInsForDates(input.actorId, [existing.startedAt], tx);
}

export async function endStudySession(id: string, input: EndSessionInput, actorId: string): Promise<StudySessionDto> {
  const session = await prisma.$transaction(async (tx) => {
    const existing = await getSessionCommandPreimage(tx, id, actorId);
    const mode = input.mode ?? "complete";
    const endFingerprint = sessionCommandFingerprint(mode === "prepare" ? "prepare-closeout" : "end", input);
    const auditAction = mode === "prepare" ? "STUDY_SESSION_CLOSEOUT_STARTED" : "STUDY_SESSION_ENDED";
    if (input.idempotencyKey && await isReusedSessionCommand(tx, id, auditAction, input.idempotencyKey, endFingerprint)) {
      return getUpdatedSessionForResponse(tx, id);
    }
    await assertSessionCommandExpectation(tx, id, existing, input.expectedStatus && input.expectedUpdatedAt && input.idempotencyKey ? {
      expectedStatus: input.expectedStatus,
      expectedUpdatedAt: input.expectedUpdatedAt,
      idempotencyKey: input.idempotencyKey,
    } : undefined);
    if (mode === "prepare") {
      if (existing.status !== "RUNNING" && existing.status !== "PAUSED") {
        throw await sessionConflict(tx, id, ["status"]);
      }
      const now = new Date();
      const pauseSeconds = existing.status === "PAUSED" && existing.pausedAt
        ? existing.accumulatedPauseSeconds + Math.max(0, Math.floor((now.getTime() - existing.pausedAt.getTime()) / 1000))
        : existing.accumulatedPauseSeconds;
      const effectiveSeconds = getTimerElapsedSeconds({
        status: "completed",
        startedAt: existing.startedAt,
        endedAt: now,
        accumulatedPauseSeconds: pauseSeconds,
      });
      await applySessionCas(tx, existing, {
        status: "CLOSING",
        endedAt: now,
        pausedAt: null,
        accumulatedPauseSeconds: pauseSeconds,
        effectiveMinutes: Math.max(0, Math.floor(effectiveSeconds / 60)),
        closeoutVersion: { increment: 1 },
      });
      await auditSessionCommand(tx, actorId, id, auditAction, input.idempotencyKey && input.expectedStatus && input.expectedUpdatedAt ? {
        idempotencyKey: input.idempotencyKey,
        expectedStatus: input.expectedStatus,
        expectedUpdatedAt: input.expectedUpdatedAt,
      } : undefined, "prepare-closeout", endFingerprint);
      return getUpdatedSessionForResponse(tx, id);
    }

    if (existing.status !== "CLOSING") {
      throw new ApiError("SESSION_CLOSEOUT_REQUIRES_CLOSING", 409, { conflictFields: ["status"] });
    }

    if (input.qualityScore === undefined || input.isEffective === undefined || !input.understandingLevel || !input.minimalOutput || !input.nextAction) {
      throw new ApiError("SESSION_CLOSEOUT_REQUIRED", 400, { conflictFields: ["qualityScore", "isEffective", "understandingLevel", "minimalOutput", "nextAction"] });
    }

    const qualityScore = input.qualityScore;
    const minimalOutput = input.minimalOutput;
    const nextAction = input.nextAction;
    if (!existing.workspaceId) {
      throw new ApiError("SESSION_WORKSPACE_REQUIRED", 409, { conflictFields: ["workspaceId"] });
    }
    const workspaceId = existing.workspaceId;

    const now = new Date();
    const pauseSeconds = existing.accumulatedPauseSeconds;
    const endedAt = existing.status === "CLOSING" && existing.endedAt ? existing.endedAt : now;
    const effectiveSeconds = getTimerElapsedSeconds({
      status: "completed",
      startedAt: existing.startedAt,
      endedAt,
      accumulatedPauseSeconds: pauseSeconds,
    });
    const effectiveMinutes = Math.max(0, Math.floor(effectiveSeconds / 60));
    const closeout = normalizeStudyCloseout({
      minutes: effectiveMinutes,
      userMarkedEffective: input.isEffective,
      understandingLevel: input.understandingLevel,
      minimalOutput,
      nextAction,
      producedNote: input.producedNote,
      producedMistake: input.producedMistake,
      note: input.note,
    });

    await applySessionCas(tx, existing, {
      status: "COMPLETED",
      endedAt,
      pausedAt: null,
      accumulatedPauseSeconds: pauseSeconds,
      effectiveMinutes,
      qualityScore,
      isEffective: closeout.isEffective,
      understandingLevel: input.understandingLevel,
      minimalOutput: input.minimalOutput,
      nextAction: input.nextAction,
      producedNote: input.producedNote,
      producedMistake: input.producedMistake,
      isLowConversion: closeout.isLowConversion,
      antiFakeReason: closeout.antiFakeReason,
      requiredOutput: closeout.requiredOutput,
      closeoutVersion: { increment: 1 },
      note: closeout.closeoutText,
    });

    const lowReasons = input.lowReasons?.length
      ? input.lowReasons
      : closeout.isLowConversion
        ? ["OTHER"]
        : [];
    await tx.studySessionCloseout.upsert({
      where: { sessionId: existing.id },
      update: {
        understanding: toCloseoutUnderstanding(input.understandingLevel),
        efficiency: toCloseoutEfficiency(closeout.isEffective, input.qualityScore),
        lowReasons: lowReasons as Prisma.InputJsonValue,
        focusLevel: input.focusLevel ?? null,
        energyLevel: input.energyLevel ?? null,
        summary: input.note?.trim() || null,
          nextDisposition: input.nextDisposition?.trim() || nextAction.trim(),
        revision: { increment: 1 },
        submittedAt: now,
        actorId,
      },
      create: {
        sessionId: existing.id,
        understanding: toCloseoutUnderstanding(input.understandingLevel),
        efficiency: toCloseoutEfficiency(closeout.isEffective, input.qualityScore),
        lowReasons: lowReasons as Prisma.InputJsonValue,
        focusLevel: input.focusLevel ?? null,
        energyLevel: input.energyLevel ?? null,
        summary: input.note?.trim() || null,
        nextDisposition: input.nextDisposition?.trim() || nextAction.trim(),
        actorId,
        submittedAt: now,
      },
    });

    const linkedKnowledgePoints = await tx.studySessionKnowledgePoint.findMany({
      where: { sessionId: existing.id },
      select: { knowledgePointId: true },
    });
    if (linkedKnowledgePoints.length > 0) {
      await tx.knowledgeEvidence.createMany({
        data: linkedKnowledgePoints.map(({ knowledgePointId }) => ({
          userId: actorId,
          workspaceId,
          knowledgePointId,
          sourceType: "SESSION",
          sessionId: existing.id,
          summary: minimalOutput.trim(),
          dimensions: {
            understandingLevel: input.understandingLevel,
            qualityScore: input.qualityScore,
            isEffective: closeout.isEffective,
            focusLevel: input.focusLevel ?? null,
            energyLevel: input.energyLevel ?? null,
            lowReasons,
          } as Prisma.InputJsonObject,
          confidence: Math.max(0, Math.min(1, qualityScore / 5)),
          occurredAt: endedAt,
        })),
      });
    }

    await tx.studySessionDevicePresence.deleteMany({ where: { sessionId: existing.id } });

    const linkedTask = existing.taskId
      ? await getTaskCommandPreimage(tx, existing.taskId, actorId)
      : null;

    if (linkedTask) {
      assertTaskSourceStatus(linkedTask, ["TODO", "IN_PROGRESS", "DEFERRED"]);
      const shouldCompleteTask = input.completeTask && closeout.isEffective;
      if (shouldCompleteTask && linkedTask.reviewScheduleId) {
        throw new ApiError("REVIEW_BRIDGE_COMPLETE_REQUIRES_RESULT", 409, {
          conflictFields: ["reviewScheduleId", "result"],
        });
      }
      await applyTaskCas(tx, linkedTask, {
        actualMinutes: { increment: effectiveMinutes },
        status: shouldCompleteTask ? "DONE" : "IN_PROGRESS",
        debtStatus: shouldCompleteTask ? "NONE" : undefined,
        completedAt: shouldCompleteTask ? now : null,
      });
      const updatedTask = await tx.studyTask.findUnique({ where: { id: linkedTask.id } });
      if (!updatedTask) throw new ApiError("TASK_STATE_CONFLICT", 409);
      if (shouldCompleteTask) {
        await createTaskDebtEvent({
          taskId: updatedTask.id,
          actorId,
          action: "complete",
          from: toTaskDebtEventState(linkedTask),
          to: toTaskDebtEventState(updatedTask),
          reason: "计时结束时勾选完成且本次有效",
          metadata: {
            source: "study_session_end",
            studySessionId: existing.id,
            effectiveMinutes,
            qualityScore: input.qualityScore,
            startedAt: existing.startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            isLowConversion: closeout.isLowConversion,
            producedNote: input.producedNote,
            producedMistake: input.producedMistake,
            taskType: linkedTask.type,
          },
        }, tx);
      }
    }

    if (existing.syllabusNodeId && effectiveMinutes > 0) {
      await tx.syllabusNode.update({
        where: { id: existing.syllabusNodeId },
        data: {
          actualMinutes: {
            increment: effectiveMinutes,
          },
        },
      });
    }

    await auditSessionCommand(tx, actorId, id, auditAction, input.idempotencyKey && input.expectedStatus && input.expectedUpdatedAt ? {
      idempotencyKey: input.idempotencyKey,
      expectedStatus: input.expectedStatus,
      expectedUpdatedAt: input.expectedUpdatedAt,
    } : undefined, "end", endFingerprint);
    const refreshedCheckIns = await refreshWorkspaceCheckInsForDates(
      actorId,
      [existing.startedAt, linkedTask?.plannedDate ?? null],
      tx,
    );
    const sessionDay = getStudyDayRange(existing.startedAt);
    const sessionCheckIn = refreshedCheckIns.get(sessionDay.start.getTime());
    if (sessionCheckIn) {
      const workspace = await resolveActiveWorkspace(actorId, tx);
      await applyRecoveryV2CheckInProgressInTx(tx, actorId, workspace.id, {
        studyDate: sessionDay.start,
        effectiveSessionMinutes: sessionCheckIn.effectiveMinutes,
        confirmedReviewSeconds: sessionCheckIn.reviewSeconds,
        now,
      });
    }

    return getUpdatedSessionForResponse(tx, id);
  });

  return serializeSession(session);
}

export async function linkStudySessionEvidence(
  sessionId: string,
  input: LinkSessionEvidenceInput,
  actorId: string,
): Promise<{ session: StudySessionDto; receipt: StudySessionEvidenceReceiptDto }> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = buildPersistentCreateFingerprint("study-session-evidence-link-v1", {
    sessionId,
    expectedCloseoutVersion: input.expectedCloseoutVersion,
    evidenceType: input.evidenceType,
    evidenceId: input.evidenceId,
  });

  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const session = await tx.studySession.findFirst({
      where: { id: sessionId, subject: { workspaceId: workspace.id } },
      include: { subject: true, task: true, syllabusNode: true },
    });
    if (!session) throw new ApiError("SESSION_NOT_FOUND", 404);
    if (session.status !== "COMPLETED") {
      throw new ApiError("SESSION_EVIDENCE_REQUIRES_COMPLETED", 409, { conflictFields: ["status"] });
    }
    if (session.closeoutVersion !== input.expectedCloseoutVersion) {
      throw new ApiError("SESSION_STATE_CONFLICT", 409, {
        latest: serializeSession(session),
        conflictFields: ["closeoutVersion"],
      });
    }

    const command: PersistentCreateCommand = {
      actorId,
      workspaceId: workspace.id,
      action: "STUDY_SESSION_EVIDENCE_LINKED",
      entityType: "StudySession",
      idempotencyKey,
      requestFingerprint,
      conflictCode: "SESSION_EVIDENCE_IDEMPOTENCY_CONFLICT",
    };
    const replay = await findPersistentCreateReplay(tx, command);
    if (replay) {
      return {
        session: serializeSession(session),
        receipt: parseSessionEvidenceReceipt(replay.resultSnapshot) ?? {
          evidenceType: input.evidenceType,
          evidenceId: input.evidenceId,
          label: sessionEvidenceTypeLabel(input.evidenceType),
        },
      };
    }

    const receipt = await validateSessionEvidence(tx, workspace.id, session, input);
    const updated = await tx.studySession.update({
      where: { id: session.id },
      data: {
        ...(input.evidenceType === "note" ? { producedNote: true } : {}),
        ...(input.evidenceType === "mistake" ? { producedMistake: true } : {}),
      },
      include: { subject: true, task: true, syllabusNode: true },
    });
    await recordPersistentCreateResult(tx, command, session.id, {
      sessionId: session.id,
      evidenceType: receipt.evidenceType,
      evidenceId: receipt.evidenceId,
      label: receipt.label,
      resultSnapshot: receipt as unknown as Prisma.InputJsonObject,
    });
    return { session: serializeSession(updated), receipt };
  });
}
