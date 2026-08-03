import {
  buildDailyCheckInSnapshot,
  createDashboardSnapshot,
  createRecoveryPlan,
  evaluateMotivationWake,
  evaluateStageLevel,
  evaluateDailyCheckIn,
  getTimerElapsedSeconds,
  normalizeStudyCloseout,
  rankRecoveryTaskCandidates,
  suggestTaskDebtReorder,
  type DashboardInput,
  type RecoveryPlan,
  type RiskState,
  type StudyTaskInput,
  type TaskDebtReorderPressure,
} from "@areaforge/core";
import { createHash, randomUUID } from "node:crypto";
import { prisma, type Prisma, type PrismaClient } from "@areaforge/db";
import { cache } from "react";
import { ApiError } from "@/lib/api/responses";
import { daysUntil, getNextStudyDayStart, getStudyDayKey, getStudyDayRange } from "./date";
import { finalExamDate, simulationDate } from "./exam-dates";
import {
  listCheckInSnapshotsInRange,
  refreshWorkspaceCheckInSnapshotForDate,
  type CheckInV2Dto,
} from "./check-in-service";
import {
  applySessionCas,
  applyTaskCas,
  isUniqueConstraintViolation,
  type TaskCasPreimage,
} from "./concurrency";
import { assertSyllabusNodeBelongsToSubject } from "./syllabus-service";
import { createTaskDebtEvent } from "./task-debt-event-service";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import {
  buildPersistentCreateFingerprint,
  claimPersistentCreateCommand,
  completePersistentCreateClaim,
  findPersistentCreateReplay,
  normalizeIdempotencyKey,
  recordPersistentCreateResult,
  type PersistentCreateCommand,
} from "./persistent-idempotency";
import { applyRecoveryV2CheckInProgressInTx } from "./recovery-v2-service";
import { assertSuccessorStartAllowed, lockWorkspaceDependencyGraph } from "./task-dependency-service";
import { createPlanInboxItemWithResult } from "./plan-inbox-service";
import { fromDbTaskStatus, serializeTask, toDbPriority } from "./task-serializer";
import { loadTaskUpdateSnapshotForWorkspace } from "./task-detail-service";
import { getStudySessionStartTimeError } from "./session-time";
import type {
  DailyReviewDto,
  MotivationVaultDto,
  RecoveryStateDto,
  StudySessionDto,
  StudySessionEvidenceReceiptDto,
  StudySessionEvidenceTypeDto,
  StudySessionKnowledgePointDto,
  StudySessionLowReasonDto,
  StudySessionStartSourceDto,
  StudyTaskDto,
  SubjectDto,
  TaskStatusDto,
  TaskDebtReorderDto,
  SyllabusOverviewDto,
  TodayDashboardDto,
} from "./types";

const recoveryStateLockKey = 2026070703;

type DbTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED";
type DbTaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type DbStudySessionStatus = "RUNNING" | "PAUSED" | "CLOSING" | "COMPLETED" | "CANCELED";
type StudyDbClient = PrismaClient | Prisma.TransactionClient;

type DbRecoveryStateStatus = "active" | "completed" | "canceled";
type DbRecoveryTriggerType = "rule" | "manual";
type RecoveryStateRecord = {
  id: string;
  status: string;
  triggerType: string;
  startedAt: Date;
  endedAt: Date | null;
  targetMinutes: number;
  visibleTaskLimit: number;
  reason: string;
  exitCondition: string | null;
  metadata: Prisma.JsonValue | null;
  actorId: string | null;
};

export interface GetTodayDashboardOptions {
  recordRecoveryRule?: boolean;
}

export interface CreateTaskInput {
  idempotencyKey: string;
  subjectId: string;
  syllabusNodeId?: string | null;
  relatedSyllabusNodeIds?: string[];
  planMilestoneId?: string | null;
  stagePlanIds?: string[];
  knowledgePointIds?: string[];
  sourceResourceId?: string;
  title: string;
  type: string;
  priority: "low" | "medium" | "high" | "critical";
  plannedDate?: string;
  estimatedMinutes: number;
}

export interface UpdateTaskInput {
  expectedStatus: TaskStatusDto;
  expectedUpdatedAt: string;
  subjectId?: string;
  syllabusNodeId?: string | null;
  relatedSyllabusNodeIds?: string[];
  planMilestoneId?: string | null;
  stagePlanIds?: string[];
  knowledgePointIds?: string[];
  title?: string;
  type?: string;
  priority?: "low" | "medium" | "high" | "critical";
  plannedDate?: string;
  estimatedMinutes?: number;
  reviewText?: string | null;
}

export interface EndSessionInput {
  mode?: "prepare" | "complete";
  qualityScore?: number;
  isEffective?: boolean;
  understandingLevel?: string;
  minimalOutput?: string;
  nextAction?: string;
  producedNote: boolean;
  producedMistake: boolean;
  note?: string;
  completeTask: boolean;
  expectedStatus?: "running" | "paused" | "closing";
  expectedUpdatedAt?: string;
  idempotencyKey?: string;
  lowReasons?: StudySessionLowReasonDto[];
  focusLevel?: number;
  energyLevel?: number;
  nextDisposition?: string;
}

export interface SessionCommandInput {
  expectedStatus: "running" | "paused" | "closing";
  expectedUpdatedAt: string;
  idempotencyKey: string;
}

export interface UpdateSessionContextInput {
  taskId?: string | null;
  syllabusNodeId?: string | null;
  knowledgePointIds?: string[];
  expectedStatus: "running" | "paused" | "closing";
  expectedUpdatedAt: string;
  idempotencyKey: string;
}

export interface StudySessionHeartbeatInput {
  clientDeviceId?: string;
  clientDeviceLabel?: string;
}

export interface LinkSessionEvidenceInput {
  idempotencyKey: string;
  expectedCloseoutVersion: number;
  evidenceType: StudySessionEvidenceTypeDto;
  evidenceId: string;
}

export interface RecoverTaskInput {
  plannedDate?: string;
  reviewText?: string;
}

export interface SplitTaskInput {
  title: string;
  plannedDate?: string;
  estimatedMinutes: number;
  reviewText?: string;
}

export interface ConvertTaskToReviewInput {
  plannedDate?: string;
  estimatedMinutes?: number;
  reviewText?: string;
}

export interface StartManualRecoveryStateInput {
  reason?: string;
  targetMinutes?: number;
  visibleTaskLimit?: number;
}

export interface FinishRecoveryStateInput {
  exitCondition?: string;
}

export interface ReviewContentInput {
  summary: string;
  lostControl?: string;
  keepAction: string;
  tomorrowMinimum: string;
  mood?: string;
}

export interface SaveTodayReviewInput extends ReviewContentInput {
  idempotencyKey?: string;
}

export interface SaveReviewInput extends ReviewContentInput {
  idempotencyKey: string;
}

export interface UpdateReviewInput extends SaveReviewInput {
  expectedRevision: number;
}

export interface SaveMotivationVaultInput {
  idempotencyKey: string;
  expectedUpdatedAt: string | null;
  whyStarted?: string;
  neverReturnTo?: string;
  futureSelf?: string;
  messageToFuture?: string;
  firstSimulationDiary?: string;
}

export async function getTodayDashboard(
  actorId: string,
  now = new Date(),
  options: GetTodayDashboardOptions = {},
): Promise<TodayDashboardDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const day = getStudyDayRange(now);
  const recentStart = new Date(day.start.getTime() - 60 * 24 * 60 * 60 * 1000);
  const weeklyStart = new Date(day.start.getTime() - 6 * 24 * 60 * 60 * 1000);

  const [
    subjects,
    tasks,
    todaySessions,
    activeSession,
    review,
    debtCount,
    overdueTasks,
    recentSessions,
    checkInSnapshots,
    motivationVault,
    activeRecoveryState,
  ] = await Promise.all([
    prisma.subject.findMany({
      where: { workspaceId: workspace.id, archivedAt: null },
      orderBy: { sortOrder: "asc" },
      include: {
        syllabusNodes: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    }),
    prisma.studyTask.findMany({
      where: {
        subject: { workspaceId: workspace.id, archivedAt: null },
        plannedDate: {
          gte: day.start,
          lt: day.end,
        },
      },
      include: {
        subject: true,
        syllabusNode: true,
        stageLinks: { include: { stagePlan: { select: { name: true } } } },
        knowledgePointLinks: { include: { knowledgePoint: { select: { title: true } } } },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    }),
    prisma.studySession.findMany({
      where: {
        subject: { workspaceId: workspace.id, archivedAt: null },
        startedAt: {
          gte: day.start,
          lt: day.end,
        },
      },
      include: {
        subject: true,
        task: true,
        syllabusNode: true,
        closeout: true,
        devicePresences: true,
        knowledgeLinks: { include: { knowledgePoint: { select: { id: true, title: true, masteryState: true } } }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { startedAt: "asc" },
    }),
    prisma.studySession.findFirst({
      where: {
        subject: { workspaceId: workspace.id, archivedAt: null },
        status: {
          in: ["RUNNING", "PAUSED", "CLOSING"],
        },
      },
      include: {
        subject: true,
        task: true,
        syllabusNode: true,
        closeout: true,
        devicePresences: true,
        knowledgeLinks: { include: { knowledgePoint: { select: { id: true, title: true, masteryState: true } } }, orderBy: { createdAt: "asc" } },
      },
      orderBy: { startedAt: "desc" },
    }),
    prisma.dailyReview.findFirst({
      where: { reviewDate: day.start, workspaceId: workspace.id },
    }),
    prisma.studyTask.count({
      where: {
        subject: { workspaceId: workspace.id, archivedAt: null },
        plannedDate: {
          lt: day.start,
        },
        status: {
          notIn: ["DONE", "SKIPPED"],
        },
      },
    }),
    // 单次取 12 条逾期任务：前 5 条给欠账预览，全量给欠账重排，替代原先两条同条件查询。
    prisma.studyTask.findMany({
      where: {
        subject: { workspaceId: workspace.id, archivedAt: null },
        plannedDate: {
          lt: day.start,
        },
        status: {
          notIn: ["DONE", "SKIPPED"],
        },
      },
      include: {
        subject: true,
        syllabusNode: true,
        stageLinks: { include: { stagePlan: { select: { name: true } } } },
        knowledgePointLinks: { include: { knowledgePoint: { select: { title: true } } } },
      },
      orderBy: [{ priority: "desc" }, { plannedDate: "asc" }],
      take: 12,
    }),
    prisma.studySession.findMany({
      where: {
        subject: { workspaceId: workspace.id, archivedAt: null },
        startedAt: {
          gte: recentStart,
          lt: day.end,
        },
        status: "COMPLETED",
        isEffective: true,
      },
      select: {
        startedAt: true,
        effectiveMinutes: true,
      },
    }),
    listCheckInSnapshotsInRange(recentStart, day.end, prisma, workspace.id),
    prisma.motivationVault.findFirst({
      orderBy: { createdAt: "asc" },
    }),
    findActiveRecoveryState(),
  ]);

  const sessionDtos = todaySessions.map(serializeSession);
  const taskDtos = tasks.map(serializeTask);
  const debtReorderTaskDtos = overdueTasks.map(serializeTask);
  const debtTaskDtos = debtReorderTaskDtos.slice(0, 5);
  const todayMinutes = sumTodayMinutes(sessionDtos, activeSession ? serializeSession(activeSession) : null, now);
  const derivedDailySnapshot = buildDailyCheckInSnapshot({
    studyDate: day.key,
    sessions: sessionDtos.map(toCheckInSnapshotSession),
    tasks: taskDtos.map((task) => ({ status: task.status })),
    reviewSubmitted: Boolean(review),
  });
  const dailySnapshot = checkInSnapshots.get(day.key) ?? derivedDailySnapshot;
  const effectiveMinutes = dailySnapshot.effectiveMinutes;
  const effectiveSessionCount = dailySnapshot.effectiveSessionCount;
  const lowConversionCount = dailySnapshot.lowConversionCount;
  const latestCompletedSession = getLatestCompletedSession(sessionDtos);
  const taskCompletionRate = dailySnapshot.taskCompletionRate;
  const streakDays = getEffectiveStudyStreak(recentSessions, checkInSnapshots, now);
  const missedDays = Math.max(0, Math.min(7, 7 - streakDays));
  const recentEffectiveMinutes = sumEffectiveMinutesByStudyDay(weeklyStart, 7, recentSessions, checkInSnapshots);
  const syllabusProgress = getOverallSyllabusProgress(subjects);

  const dashboardInput: DashboardInput = {
    targetExamDate: finalExamDate,
    simulationDate,
    todayMinutes,
    effectiveMinutes,
    taskCompletionRate,
    streakDays,
    missedDays,
    debtCount,
    daysToFinal: daysUntil(finalExamDate, now),
    daysToSimulation: daysUntil(simulationDate, now),
    tasks: taskDtos.map(toCoreTask),
  };

  const snapshot = createDashboardSnapshot(dashboardInput);
  const stage = evaluateStageLevel({
    streakDays,
    todayEffectiveMinutes: effectiveMinutes,
    recentEffectiveMinutes,
    taskCompletionRate,
    syllabusProgress,
    daysToFinal: dashboardInput.daysToFinal,
  });
  const motivationWake = evaluateMotivationWake({
    hasVault: Boolean(motivationVault),
    riskState: snapshot.riskState,
    missedDays,
    debtCount,
    daysToSimulation: dashboardInput.daysToSimulation,
    hasMajorReview: isMajorReview(review),
    todayMood: review?.mood,
  });
  const checkIn = evaluateDailyCheckIn({
    effectiveMinutes,
    effectiveSessionCount,
    reviewSubmitted: dailySnapshot.reviewSubmitted,
    taskCompletionRate,
  });
  const recoveryTaskCandidates = getRecoveryTaskCandidates(taskDtos, debtTaskDtos);
  const topRecoveryTask = recoveryTaskCandidates[0] ?? null;
  const realtimeRecovery = createRecoveryPlan({
    riskState: snapshot.riskState,
    debtCount,
    missedDays,
    effectiveMinutes,
    topTask: topRecoveryTask ? toCoreTask(topRecoveryTask) : snapshot.topTasks[0],
  });
  const recoveryState = activeRecoveryState ?? (
    options.recordRecoveryRule && realtimeRecovery.active
      ? await createRuleRecoveryState({
        plan: realtimeRecovery,
        actorId,
        topTask: topRecoveryTask,
        riskState: snapshot.riskState,
        debtCount,
        missedDays,
        effectiveMinutes,
        studyDayKey: day.key,
      })
      : null
  );
  const recovery = recoveryState
    ? createDashboardRecoveryFromState(recoveryState, topRecoveryTask)
    : createDashboardRecoveryFromRealtimePlan(realtimeRecovery);
  const visibleRecoveryTasks = recovery.active
    ? recoveryTaskCandidates.slice(0, recovery.visibleTaskLimit)
    : taskDtos;
  const debtReorder = createTaskDebtReorder({
    tasks: debtReorderTaskDtos,
    dayStart: day.start,
    pressure: determineDebtReorderPressure(snapshot.riskState, stage.pressure, recovery.active),
    availableMinutes: determineDebtReorderAvailableMinutes(stage.pressure, recovery.active, recovery.minimumMinutes),
  });

  return {
    studyDay: {
      key: day.key,
      start: day.start.toISOString(),
      end: day.end.toISOString(),
    },
    metrics: {
      daysToSimulation: dashboardInput.daysToSimulation,
      daysToFinal: dashboardInput.daysToFinal,
      todayMinutes,
      effectiveMinutes,
      taskCompletionRate,
      streakDays,
      missedDays,
      debtCount,
    },
    snapshot,
    stage,
    motivationWake,
    checkIn: {
      completedMinimumAction: dailySnapshot.completedMinimumAction,
      lowEfficiency: dailySnapshot.lowEfficiency,
      reason: checkIn.reason,
      effectiveSessionCount,
      reviewSubmitted: dailySnapshot.reviewSubmitted,
    },
    recovery,
    subjects: subjects.map(serializeSubject),
    tasks: taskDtos,
    debtTasks: debtTaskDtos,
    debtReorder,
    visibleRecoveryTasks,
    activeSession: activeSession ? serializeSession(activeSession) : null,
    latestCompletedSession,
    review: review ? serializeReview(review) : null,
    syllabusOverview: subjects.map((subject) => serializeSyllabusOverview(subject)),
    signals: {
      antiFake: lowConversionCount > 0
        ? `存在 ${lowConversionCount} 段低转化学习，今天还需要补一个可检查产出`
        : "结束计时后会检查本次学习是否留下产出",
      lowConversionCount,
      review: dailySnapshot.reviewSubmitted ? "今日复盘已提交" : "还未提交今日复盘",
      ai: "首页仅展示本地规则 AI 建议；真实 provider 只由鉴权 AI API 显式触发",
    },
  };
}

/**
 * 同一次服务端渲染内的只读共享副本：AI 建议、长期风险等次级消费方复用同一份
 * 作战台数据，避免每个消费方重复触发整组 Prisma 查询。写路径（recordRecoveryRule）
 * 仍走 getTodayDashboard 原函数。
 */
export const getTodayDashboardShared = cache(
  async (actorId: string): Promise<TodayDashboardDto> => getTodayDashboard(actorId),
);

export async function getTaskDebtReorderSuggestion(actorId: string, now = new Date()): Promise<TaskDebtReorderDto> {
  const dashboard = await getTodayDashboard(actorId, now);
  return dashboard.debtReorder;
}

export async function startManualRecoveryState(
  input: StartManualRecoveryStateInput,
  actorId: string,
): Promise<RecoveryStateDto> {
  const state = await prisma.$transaction(async (tx) => {
    await lockRecoveryState(tx);
    const activeState = await findActiveRecoveryState(tx);
    if (activeState) return activeState;

    return tx.recoveryState.create({
      data: {
        status: "active",
        triggerType: "manual",
        targetMinutes: normalizeRecoveryTargetMinutes(input.targetMinutes, 30),
        visibleTaskLimit: normalizeRecoveryVisibleTaskLimit(input.visibleTaskLimit, 1),
        reason: normalizeOptionalText(input.reason)
          ?? "手动进入恢复：今天先把任务面缩到最小，恢复有效学习连续性。",
        actorId,
        metadata: {
          source: "manual_recovery_api",
        },
      },
    });
  });

  return serializeRecoveryState(state);
}

export async function completeRecoveryState(
  id: string,
  input: FinishRecoveryStateInput,
): Promise<RecoveryStateDto> {
  return finishRecoveryState(id, "completed", input.exitCondition, "用户标记恢复完成");
}

export async function cancelRecoveryState(
  id: string,
  input: FinishRecoveryStateInput,
): Promise<RecoveryStateDto> {
  return finishRecoveryState(id, "canceled", input.exitCondition, "用户取消恢复状态");
}

export async function createStudyTask(input: CreateTaskInput, actorId: string): Promise<StudyTaskDto> {
  const day = input.plannedDate ? new Date(input.plannedDate) : getStudyDayRange().start;
  const relatedSyllabusNodeIds = normalizeTaskRelatedNodeIds(input.relatedSyllabusNodeIds ?? []);
  const stagePlanIds = normalizeTaskStageIds(input.stagePlanIds ?? []);
  const knowledgePointIds = normalizeTaskKnowledgePointIds(input.knowledgePointIds ?? []);
  assertTaskSyllabusRelationsDistinct(input.syllabusNodeId ?? null, relatedSyllabusNodeIds);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = buildPersistentCreateFingerprint("study-task-create-v1", {
    subjectId: input.subjectId,
    syllabusNodeId: input.syllabusNodeId ?? null,
    relatedSyllabusNodeIds,
    planMilestoneId: input.planMilestoneId ?? null,
    stagePlanIds,
    knowledgePointIds,
    sourceResourceId: input.sourceResourceId ?? null,
    title: input.title,
    type: input.type,
    priority: input.priority,
    plannedDate: day.toISOString(),
    estimatedMinutes: input.estimatedMinutes,
  });
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = {
      actorId,
      workspaceId: workspace.id,
      action: "STUDY_TASK_CREATED",
      entityType: "StudyTask",
      idempotencyKey,
      requestFingerprint,
      conflictCode: "STUDY_TASK_IDEMPOTENCY_CONFLICT",
    };
    const replay = await findPersistentCreateReplay(tx, command);
    if (replay) {
      const snapshot = parseStudyTaskSnapshot(replay.resultSnapshot);
      if (snapshot) return snapshot;
      const storedTask = await tx.studyTask.findFirst({
        where: { id: replay.resultId, subject: { workspaceId: workspace.id } },
        include: {
          subject: true,
          syllabusNode: true,
          stageLinks: { include: { stagePlan: { select: { name: true } } } },
          knowledgePointLinks: { include: { knowledgePoint: { select: { title: true } } } },
        },
      });
      if (!storedTask) throw new ApiError("STUDY_TASK_IDEMPOTENCY_RESULT_NOT_FOUND", 409);
      return serializeTask(storedTask);
    }
    await assertSubjectExists(input.subjectId, workspace.id, tx);
    const sourceResource = input.sourceResourceId ? await tx.studyResource.findFirst({
      where: { id: input.sourceResourceId, workspaceId: workspace.id },
      select: { id: true, subjectId: true, archivedAt: true, revision: true },
    }) : null;
    if (input.sourceResourceId && !sourceResource) throw new ApiError("STUDY_RESOURCE_NOT_FOUND", 404);
    if (sourceResource?.archivedAt) {
      throw new ApiError("STUDY_RESOURCE_ARCHIVED", 409, {
        latest: sourceResource,
        conflictFields: ["archivedAt"],
        workbench: "/knowledge/resources",
      });
    }
    if (sourceResource?.subjectId && sourceResource.subjectId !== input.subjectId) {
      throw new ApiError("STUDY_RESOURCE_SUBJECT_MISMATCH", 409, {
        latest: sourceResource,
        conflictFields: ["subjectId"],
        workbench: "/knowledge/resources",
      });
    }
    await assertActiveTaskRelations(tx, workspace.id, input.subjectId, {
      syllabusNodeIds: [input.syllabusNodeId, ...relatedSyllabusNodeIds].filter((id): id is string => Boolean(id)),
      planMilestoneId: input.planMilestoneId ?? null,
      stagePlanIds,
    });
    await assertActiveTaskKnowledgePoints(tx, workspace.id, input.subjectId, knowledgePointIds);
    const createdTask = await tx.studyTask.create({
      data: {
        subjectId: input.subjectId,
        syllabusNodeId: input.syllabusNodeId ?? null,
        planMilestoneId: input.planMilestoneId ?? null,
        title: input.title,
        type: input.type,
        priority: toDbPriority(input.priority),
        plannedDate: day,
        estimatedMinutes: input.estimatedMinutes,
      },
      include: {
        subject: true,
        syllabusNode: true,
        knowledgePointLinks: { include: { knowledgePoint: { select: { title: true } } } },
      },
    });
    if (relatedSyllabusNodeIds.length > 0) {
      await tx.studyTaskRelatedSyllabusNode.createMany({
        data: relatedSyllabusNodeIds.map((syllabusNodeId) => ({ taskId: createdTask.id, syllabusNodeId })),
      });
    }
    if (stagePlanIds.length > 0) {
      await tx.studyTaskStageLink.createMany({
        data: stagePlanIds.map((stagePlanId) => ({ taskId: createdTask.id, stagePlanId })),
      });
    }
    if (knowledgePointIds.length > 0) {
      await tx.studyTaskKnowledgePoint.createMany({
        data: knowledgePointIds.map((knowledgePointId) => ({ taskId: createdTask.id, knowledgePointId })),
      });
    }
    if (sourceResource) {
      await tx.studyResourceTaskLink.create({
        data: { resourceId: sourceResource.id, taskId: createdTask.id },
      });
      const updatedResource = await tx.studyResource.updateMany({
        where: {
          id: sourceResource.id,
          workspaceId: workspace.id,
          archivedAt: null,
          revision: sourceResource.revision,
        },
        data: { revision: { increment: 1 }, actorId },
      });
      if (updatedResource.count !== 1) {
        throw new ApiError("STUDY_RESOURCE_REVISION_CONFLICT", 409, {
          conflictFields: ["revision", "archivedAt"],
          workbench: "/knowledge/resources",
        });
      }
    }

    const result = serializeTask(await getUpdatedTaskForResponse(tx, createdTask.id));
    await recordPersistentCreateResult(tx, command, createdTask.id, {
      resultSnapshot: result as unknown as Prisma.InputJsonObject,
    });
    if (sourceResource) {
      await tx.auditEvent.create({
        data: {
          actorId,
          action: "STUDY_RESOURCE_TASK_LINKED",
          entityType: "StudyResource",
          entityId: sourceResource.id,
          metadata: { taskId: createdTask.id },
        },
      });
    }
    await refreshWorkspaceCheckInsForDates(actorId, [createdTask.plannedDate], tx);

    return result;
  });
}

export async function listStudyTasks(actorId: string): Promise<StudyTaskDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const tasks = await prisma.studyTask.findMany({
    where: { subject: { workspaceId: workspace.id } },
    include: {
      subject: true,
      syllabusNode: true,
      stageLinks: { include: { stagePlan: { select: { name: true } } } },
      knowledgePointLinks: { include: { knowledgePoint: { select: { title: true } } } },
    },
    orderBy: [{ plannedDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });

  return tasks.map(serializeTask);
}

export async function updateStudyTask(id: string, input: UpdateTaskInput, actorId: string): Promise<StudyTaskDto> {
  const task = await prisma.$transaction(async (tx) => {
    const existing = await getTaskCommandPreimage(tx, id, actorId);
    const workspace = await resolveActiveWorkspace(actorId, tx);
    await assertTaskUpdateExpectation(tx, workspace.id, existing, input);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED"]);

    const resolvedSubjectId = input.subjectId ?? existing.subjectId;
    const resolvedSyllabusNodeId = input.syllabusNodeId === undefined ? existing.syllabusNodeId : input.syllabusNodeId;
    const resolvedRelatedNodeIds = input.relatedSyllabusNodeIds === undefined
      ? existing.relatedSyllabusNodeIds
      : normalizeTaskRelatedNodeIds(input.relatedSyllabusNodeIds);
    const resolvedPlanMilestoneId = input.planMilestoneId === undefined
      ? existing.planMilestoneId
      : input.planMilestoneId;
    const resolvedStagePlanIds = input.stagePlanIds === undefined
      ? existing.stagePlanIds
      : normalizeTaskStageIds(input.stagePlanIds);
    const resolvedKnowledgePointIds = input.knowledgePointIds === undefined
      ? existing.knowledgePointIds
      : normalizeTaskKnowledgePointIds(input.knowledgePointIds);
    const subjectChanged = resolvedSubjectId !== existing.subjectId;
    const relatedNodesChanged = !sameStringSet(resolvedRelatedNodeIds, existing.relatedSyllabusNodeIds);
    const primaryNodeChanged = resolvedSyllabusNodeId !== existing.syllabusNodeId;
    const milestoneChanged = resolvedPlanMilestoneId !== existing.planMilestoneId;
    const stagePlansChanged = !sameStringSet(resolvedStagePlanIds, existing.stagePlanIds);
    const knowledgePointsChanged = !sameStringSet(resolvedKnowledgePointIds, existing.knowledgePointIds);

    assertTaskSyllabusRelationsDistinct(resolvedSyllabusNodeId, resolvedRelatedNodeIds);
    if (existing.reviewScheduleId && subjectChanged) {
      throw await taskUpdateConflict(tx, workspace.id, id, ["subjectId", "reviewScheduleId"]);
    }
    await assertSubjectExists(resolvedSubjectId, workspace.id, tx);
    try {
      await assertActiveTaskRelations(tx, workspace.id, resolvedSubjectId, {
        syllabusNodeIds: [
          ...(subjectChanged || primaryNodeChanged ? [resolvedSyllabusNodeId] : []),
          ...(subjectChanged || relatedNodesChanged ? resolvedRelatedNodeIds : []),
        ].filter((nodeId): nodeId is string => Boolean(nodeId)),
        planMilestoneId: subjectChanged || milestoneChanged ? resolvedPlanMilestoneId : null,
        stagePlanIds: subjectChanged || stagePlansChanged ? resolvedStagePlanIds : [],
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw await taskUpdateConflict(tx, workspace.id, id, error.details?.conflictFields ?? ["relations"]);
      }
      throw error;
    }
    try {
      await assertActiveTaskKnowledgePoints(tx, workspace.id, resolvedSubjectId, resolvedKnowledgePointIds);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw await taskUpdateConflict(tx, workspace.id, id, error.details?.conflictFields ?? ["knowledgePointIds"]);
      }
      throw error;
    }

    try {
      await applyTaskCas(tx, existing, {
        subjectId: input.subjectId,
        syllabusNodeId: input.syllabusNodeId,
        planMilestoneId: input.planMilestoneId,
        title: input.title,
        type: input.type,
        priority: input.priority ? toDbPriority(input.priority) : undefined,
        plannedDate: input.plannedDate ? new Date(input.plannedDate) : undefined,
        estimatedMinutes: input.estimatedMinutes,
        reviewText: input.reviewText,
        updatedAt: nextTaskUpdatedAt(existing.updatedAt),
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        throw await taskUpdateConflict(tx, workspace.id, id, ["status", "updatedAt"]);
      }
      throw error;
    }
    if (relatedNodesChanged) {
      await tx.studyTaskRelatedSyllabusNode.deleteMany({ where: { taskId: id } });
      if (resolvedRelatedNodeIds.length > 0) {
        await tx.studyTaskRelatedSyllabusNode.createMany({
          data: resolvedRelatedNodeIds.map((syllabusNodeId) => ({ taskId: id, syllabusNodeId })),
        });
      }
    }
    if (stagePlansChanged) {
      await tx.studyTaskStageLink.deleteMany({ where: { taskId: id } });
      if (resolvedStagePlanIds.length > 0) {
        await tx.studyTaskStageLink.createMany({
          data: resolvedStagePlanIds.map((stagePlanId) => ({ taskId: id, stagePlanId })),
        });
      }
    }
    if (knowledgePointsChanged) {
      await tx.studyTaskKnowledgePoint.deleteMany({ where: { taskId: id } });
      if (resolvedKnowledgePointIds.length > 0) {
        await tx.studyTaskKnowledgePoint.createMany({
          data: resolvedKnowledgePointIds.map((knowledgePointId) => ({ taskId: id, knowledgePointId })),
        });
      }
    }
    const updatedTask = await getUpdatedTaskForResponse(tx, id);

    await audit(actorId, "STUDY_TASK_UPDATED", "StudyTask", updatedTask.id, tx);
    if (input.plannedDate) {
      await refreshWorkspaceCheckInsForDates(actorId, [existing.plannedDate, updatedTask.plannedDate], tx);
    }

    return updatedTask;
  });

  return serializeTask(task);
}

export async function completeStudyTask(id: string, reviewText: string | undefined, actorId: string): Promise<StudyTaskDto> {
  const task = await prisma.$transaction(async (tx) => {
    const existing = await getTaskCommandPreimage(tx, id, actorId);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED"]);
    if (existing.reviewScheduleId) {
      throw new ApiError("REVIEW_BRIDGE_COMPLETE_REQUIRES_RESULT", 409, {
        conflictFields: ["reviewScheduleId", "result"],
      });
    }

    const completedAt = new Date();
    await applyTaskCas(tx, existing, {
      status: "DONE",
      debtStatus: "NONE",
      reviewText,
      completedAt,
    });
    const updatedTask = await getUpdatedTaskForResponse(tx, id);

    await audit(actorId, "STUDY_TASK_COMPLETED", "StudyTask", updatedTask.id, tx);
    await createTaskDebtEvent({
      taskId: updatedTask.id,
      actorId,
      action: "complete",
      from: toTaskDebtEventState(existing),
      to: toTaskDebtEventState(updatedTask),
      reason: normalizeTaskDebtReason(reviewText, "手动完成任务"),
      metadata: {
        source: "task_complete_api",
        plannedDate: existing.plannedDate.toISOString(),
        completedAt: completedAt.toISOString(),
        reviewTextProvided: Boolean(reviewText?.trim()),
        taskType: existing.type,
        actualMinutes: updatedTask.actualMinutes,
      },
    }, tx);
    await refreshWorkspaceCheckInsForDates(actorId, [updatedTask.plannedDate], tx);

    return updatedTask;
  });

  return serializeTask(task);
}

export async function deferStudyTask(id: string, plannedDate: string | undefined, reviewText: string | undefined, actorId: string): Promise<StudyTaskDto> {
  const task = await prisma.$transaction(async (tx) => {
    const existing = await getTaskCommandPreimage(tx, id, actorId);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED"], true);

    const targetPlannedDate = plannedDate ? new Date(plannedDate) : getNextStudyDayStart();
    await applyTaskCas(tx, existing, {
      status: "DEFERRED",
      debtStatus: "ACCEPTABLE",
      plannedDate: targetPlannedDate,
      reviewText,
    });
    const updatedTask = await getUpdatedTaskForResponse(tx, id);

    await audit(actorId, "STUDY_TASK_DEFERRED", "StudyTask", updatedTask.id, tx);
    await createTaskDebtEvent({
      taskId: updatedTask.id,
      actorId,
      action: "defer",
      from: toTaskDebtEventState(existing),
      to: toTaskDebtEventState(updatedTask),
      reason: normalizeTaskDebtReason(reviewText, "延期到下一学习日"),
      metadata: {
        source: "task_defer_api",
        fromPlannedDate: existing.plannedDate.toISOString(),
        toPlannedDate: targetPlannedDate.toISOString(),
        requestedPlannedDate: plannedDate ?? null,
        defaultedToNextStudyDay: plannedDate === undefined,
        taskType: existing.type,
      },
    }, tx);
    await refreshWorkspaceCheckInsForDates(actorId, [existing.plannedDate, updatedTask.plannedDate], tx);

    return updatedTask;
  });

  return serializeTask(task);
}

export async function dropStudyTask(id: string, actorId: string): Promise<StudyTaskDto> {
  const task = await prisma.$transaction(async (tx) => {
    const existing = await getTaskCommandPreimage(tx, id, actorId);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED"], true);

    await applyTaskCas(tx, existing, {
      status: "SKIPPED",
      debtStatus: "NONE",
    });
    const updatedTask = await getUpdatedTaskForResponse(tx, id);

    await audit(actorId, "STUDY_TASK_DROPPED", "StudyTask", updatedTask.id, tx);
    await createTaskDebtEvent({
      taskId: updatedTask.id,
      actorId,
      action: "drop",
      from: toTaskDebtEventState(existing),
      to: toTaskDebtEventState(updatedTask),
      reason: "放弃当前任务",
      metadata: {
        source: "task_drop_api",
        plannedDate: existing.plannedDate.toISOString(),
        taskType: existing.type,
        previousCompletedAt: existing.completedAt?.toISOString() ?? null,
      },
    }, tx);
    await refreshWorkspaceCheckInsForDates(actorId, [updatedTask.plannedDate], tx);

    return updatedTask;
  });

  return serializeTask(task);
}

export async function recoverStudyTask(id: string, input: RecoverTaskInput, actorId: string): Promise<StudyTaskDto> {
  const targetPlannedDate = input.plannedDate ? new Date(input.plannedDate) : getStudyDayRange().start;
  const task = await prisma.$transaction(async (tx) => {
    const existing = await getTaskCommandPreimage(tx, id, actorId);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED", "SKIPPED"]);
    await applyTaskCas(tx, existing, {
      status: "TODO",
      debtStatus: "ACCEPTABLE",
      plannedDate: targetPlannedDate,
      reviewText: mergeTaskReviewText(existing.reviewText, input.reviewText, "补做：拉回今天作为恢复任务"),
      completedAt: null,
    });
    const updatedTask = await getUpdatedTaskForResponse(tx, id);

    await audit(actorId, "STUDY_TASK_RECOVERED", "StudyTask", updatedTask.id, tx);
    await createTaskDebtEvent({
      taskId: updatedTask.id,
      actorId,
      action: "recover",
      from: toTaskDebtEventState(existing),
      to: toTaskDebtEventState(updatedTask),
      reason: normalizeTaskDebtReason(input.reviewText, "补做：拉回今天作为恢复任务"),
      metadata: {
        source: "task_recover_api",
        fromPlannedDate: existing.plannedDate.toISOString(),
        toPlannedDate: targetPlannedDate.toISOString(),
        requestedPlannedDate: input.plannedDate ?? null,
        previousCompletedAt: existing.completedAt?.toISOString() ?? null,
        taskType: existing.type,
      },
    }, tx);
    await refreshWorkspaceCheckInsForDates(actorId, [existing.plannedDate, updatedTask.plannedDate], tx);

    return updatedTask;
  });

  return serializeTask(task);
}

export async function splitStudyTask(id: string, input: SplitTaskInput, actorId: string): Promise<{
  originalTask: StudyTaskDto;
  task: StudyTaskDto;
}> {
  const plannedDate = input.plannedDate ? new Date(input.plannedDate) : getStudyDayRange().start;

  const [originalTask, task] = await prisma.$transaction(async (tx) => {
    const existing = await getTaskCommandPreimage(tx, id, actorId);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED"]);
    const createdTask = await tx.studyTask.create({
      data: {
        subjectId: existing.subjectId,
        syllabusNodeId: existing.syllabusNodeId,
        planMilestoneId: existing.planMilestoneId,
        parentTaskId: existing.id,
        title: input.title,
        type: existing.type === "simulation_exam" ? "review" : existing.type,
        status: "TODO",
        priority: existing.priority,
        debtStatus: "ACCEPTABLE",
        plannedDate,
        estimatedMinutes: input.estimatedMinutes,
        reviewText: mergeTaskReviewText(null, input.reviewText, `由任务「${existing.title}」拆小而来`),
      },
      include: {
        subject: true,
        syllabusNode: true,
      },
    });

    if (existing.stagePlanIds.length > 0) {
      await tx.studyTaskStageLink.createMany({
        data: existing.stagePlanIds.map((stagePlanId) => ({ taskId: createdTask.id, stagePlanId })),
      });
    }
    if (existing.relatedSyllabusNodeIds.length > 0) {
      await tx.studyTaskRelatedSyllabusNode.createMany({
        data: existing.relatedSyllabusNodeIds.map((syllabusNodeId) => ({ taskId: createdTask.id, syllabusNodeId })),
      });
    }
    if (existing.knowledgePointIds.length > 0) {
      await tx.studyTaskKnowledgePoint.createMany({
        data: existing.knowledgePointIds.map((knowledgePointId) => ({ taskId: createdTask.id, knowledgePointId })),
      });
    }

    await applyTaskCas(tx, existing, {
      status: "DEFERRED",
      debtStatus: "ACCEPTABLE",
      reviewText: mergeTaskReviewText(existing.reviewText, input.reviewText, `拆小：生成「${input.title}」作为最小推进任务`),
    });
    const updatedOriginal = await getUpdatedTaskForResponse(tx, id);

    await audit(actorId, "STUDY_TASK_SPLIT_LIGHTWEIGHT", "StudyTask", createdTask.id, tx);
    await createTaskDebtEvent({
      taskId: updatedOriginal.id,
      actorId,
      action: "split",
      from: toTaskDebtEventState(existing),
      to: toTaskDebtEventState(updatedOriginal),
      relatedTaskId: createdTask.id,
      reason: normalizeTaskDebtReason(input.reviewText, `拆小：生成「${input.title}」作为最小推进任务`),
      metadata: {
        source: "task_split_api",
        childTaskId: createdTask.id,
        childTitle: createdTask.title,
        childPlannedDate: createdTask.plannedDate.toISOString(),
        childEstimatedMinutes: createdTask.estimatedMinutes,
        childType: createdTask.type,
        parentTaskId: existing.id,
        originalEstimatedMinutes: existing.estimatedMinutes,
        originalStatusWasTerminal: false,
      },
    }, tx);
    await refreshWorkspaceCheckInsForDates(actorId, [existing.plannedDate, createdTask.plannedDate], tx);

    const updatedChild = await getUpdatedTaskForResponse(tx, createdTask.id);
    return [updatedOriginal, updatedChild];
  });

  return {
    originalTask: serializeTask(originalTask),
    task: serializeTask(task),
  };
}

export async function convertStudyTaskToReview(
  id: string,
  input: ConvertTaskToReviewInput,
  actorId: string,
): Promise<StudyTaskDto> {
  const task = await prisma.$transaction(async (tx) => {
    const existing = await getTaskCommandPreimage(tx, id, actorId);
    assertTaskSourceStatus(existing, ["TODO", "IN_PROGRESS", "DEFERRED", "SKIPPED"]);
    await applyTaskCas(tx, existing, {
      type: "review",
      status: "TODO",
      debtStatus: "ACCEPTABLE",
      plannedDate: input.plannedDate ? new Date(input.plannedDate) : getStudyDayRange().start,
      estimatedMinutes: input.estimatedMinutes ?? Math.min(90, Math.max(25, existing.estimatedMinutes)),
      reviewText: mergeTaskReviewText(existing.reviewText, input.reviewText, "改成复习任务：先复盘产出，再决定是否继续原任务"),
      completedAt: null,
    });
    const updatedTask = await getUpdatedTaskForResponse(tx, id);

    await audit(actorId, "STUDY_TASK_CONVERTED_TO_REVIEW", "StudyTask", updatedTask.id, tx);
    await createTaskDebtEvent({
      taskId: updatedTask.id,
      actorId,
      action: "convert_review",
      from: toTaskDebtEventState(existing),
      to: toTaskDebtEventState(updatedTask),
      reason: normalizeTaskDebtReason(input.reviewText, "改成复习任务：先复盘产出，再决定是否继续原任务"),
      metadata: {
        source: "task_convert_review_api",
        fromType: existing.type,
        toType: "review",
        fromPlannedDate: existing.plannedDate.toISOString(),
        toPlannedDate: updatedTask.plannedDate.toISOString(),
        fromEstimatedMinutes: existing.estimatedMinutes,
        toEstimatedMinutes: updatedTask.estimatedMinutes,
        previousCompletedAt: existing.completedAt?.toISOString() ?? null,
      },
    }, tx);
    await refreshWorkspaceCheckInsForDates(actorId, [existing.plannedDate, updatedTask.plannedDate], tx);

    return updatedTask;
  });

  return serializeTask(task);
}

export async function getActiveStudySession(actorId: string): Promise<StudySessionDto | null> {
  const workspace = await resolveActiveWorkspace(actorId);
  const session = await prisma.studySession.findFirst({
    where: {
      userId: actorId,
      workspaceId: workspace.id,
      subject: { workspaceId: workspace.id },
      status: {
        in: ["RUNNING", "PAUSED", "CLOSING"],
      },
    },
    include: {
      subject: true,
      task: true,
      syllabusNode: true,
      closeout: true,
      devicePresences: true,
      knowledgeLinks: { include: { knowledgePoint: { select: { id: true, title: true, masteryState: true } } }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { startedAt: "desc" },
  });

  return session ? serializeSession(session) : null;
}

export async function getStudySessionById(id: string, actorId: string): Promise<StudySessionDto | null> {
  const workspace = await resolveActiveWorkspace(actorId);
  const session = await prisma.studySession.findFirst({
    where: { id, userId: actorId, workspaceId: workspace.id },
    include: { subject: true, task: true, syllabusNode: true, closeout: true, devicePresences: true, knowledgeLinks: { include: { knowledgePoint: { select: { id: true, title: true, masteryState: true } } }, orderBy: { createdAt: "asc" } } },
  });
  return session ? serializeSession(session) : null;
}

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
        workbench: `/plan/tasks/${task.id}`,
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
    if (!existing || existing.status !== "PAUSED" || !existing.pausedAt) {
      throw await sessionConflict(tx, id, ["status", "pausedAt"]);
    }

    const now = new Date();
    const extraPauseSeconds = Math.max(0, Math.floor((now.getTime() - existing.pausedAt.getTime()) / 1000));
    await applySessionCas(tx, existing, {
      status: "RUNNING",
      pausedAt: null,
      accumulatedPauseSeconds: existing.accumulatedPauseSeconds + extraPauseSeconds,
    });
    await auditSessionCommand(tx, actorId, id, "STUDY_SESSION_RESUMED", input, "resume");

    return getUpdatedSessionForResponse(tx, id);
  });

  return serializeSession(session);
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

export async function listStudySessionEvidenceReceipts(
  sessionId: string,
  actorId: string,
): Promise<StudySessionEvidenceReceiptDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const ownedSession = await prisma.studySession.findFirst({
    where: { id: sessionId, subject: { workspaceId: workspace.id } },
    select: { id: true },
  });
  if (!ownedSession) throw new ApiError("SESSION_NOT_FOUND", 404);
  const events = await prisma.auditEvent.findMany({
    where: {
      actorId,
      action: "STUDY_SESSION_EVIDENCE_LINKED",
      entityType: "StudySession",
      entityId: sessionId,
    },
    orderBy: { createdAt: "asc" },
    select: { metadata: true },
  });
  return events.flatMap((event) => {
    const receipt = parseSessionEvidenceReceipt(event.metadata);
    return receipt ? [receipt] : [];
  });
}

async function validateSessionEvidence(
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

function assertSessionEvidenceContext(
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

function parseSessionEvidenceReceipt(value: Prisma.JsonValue | undefined | null): StudySessionEvidenceReceiptDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (
    (value.evidenceType !== "note" && value.evidenceType !== "mistake" && value.evidenceType !== "retest") ||
    typeof value.evidenceId !== "string" ||
    typeof value.label !== "string"
  ) return null;
  return {
    evidenceType: value.evidenceType,
    evidenceId: value.evidenceId,
    label: value.label,
  };
}

function sessionEvidenceTypeLabel(value: StudySessionEvidenceTypeDto): string {
  if (value === "note") return "知识卡片";
  if (value === "mistake") return "错题";
  return "复测";
}

export async function getTodayReview(actorId: string): Promise<DailyReviewDto | null> {
  return getDailyReview(actorId, new Date());
}

export async function getDailyReview(actorId: string, targetDate: Date): Promise<DailyReviewDto | null> {
  const workspace = await resolveActiveWorkspace(actorId);
  const day = getStudyDayRange(targetDate);
  const review = await prisma.dailyReview.findFirst({
    where: { reviewDate: day.start, workspaceId: workspace.id },
  });

  return review ? serializeReview(review) : null;
}

export async function saveTodayReview(input: SaveTodayReviewInput, actorId: string): Promise<DailyReviewDto> {
  const day = getStudyDayRange(new Date());
  const idempotencyKey = input.idempotencyKey === undefined
    ? null
    : normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = idempotencyKey
    ? buildPersistentCreateFingerprint("daily-review-save-today-v1", {
        reviewDate: day.start.toISOString(),
        ...dailyReviewCommandPayload(input),
      })
    : null;

  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = idempotencyKey && requestFingerprint
      ? dailyReviewCommand(actorId, workspace.id, "DAILY_REVIEW_TODAY_SAVED", idempotencyKey, requestFingerprint)
      : null;
    if (command) {
      const replay = await replayDailyReviewCommand(tx, command, async () => {
        const latest = await tx.dailyReview.findFirst({
          where: { reviewDate: day.start, workspaceId: workspace.id },
        });
        return latest ? serializeReview(latest) : null;
      });
      if (replay) return replay;
    }

    const existing = await tx.dailyReview.findFirst({
      where: { reviewDate: day.start, workspaceId: workspace.id },
    });
    const metrics = await getTodaySessionMetrics(day.start, day.end, workspace.id, tx);
    const savedReview = existing
      ? await updateTodayReview(tx, workspace.id, existing, input, metrics)
      : await tx.dailyReview.create({
          data: { reviewDate: day.start, workspaceId: workspace.id, ...createReviewData(input, metrics) },
        });
    await syncReviewMinimumInbox(tx, workspace.id, actorId, savedReview, day.end, input.tomorrowMinimum);
    await refreshWorkspaceCheckInSnapshotForDate(workspace.id, day.start, tx);
    const result = serializeReview(savedReview);
    if (command) {
      await recordDailyReviewCommandResult(tx, command, result);
    } else {
      await audit(actorId, existing ? "DAILY_REVIEW_UPDATED" : "DAILY_REVIEW_SAVED", "DailyReview", savedReview.id, tx);
    }
    return result;
  });
}

export async function createDailyReview(
  input: SaveReviewInput,
  actorId: string,
  targetDate = new Date(),
): Promise<DailyReviewDto> {
  const day = getStudyDayRange(targetDate);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = buildPersistentCreateFingerprint("daily-review-create-v1", {
    reviewDate: day.start.toISOString(),
    ...dailyReviewCommandPayload(input),
  });
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = dailyReviewCommand(actorId, workspace.id, "DAILY_REVIEW_SAVED", idempotencyKey, requestFingerprint);
    const replay = await replayDailyReviewCommand(tx, command, async () => {
      const latest = await tx.dailyReview.findFirst({
        where: { reviewDate: day.start, workspaceId: workspace.id },
      });
      return latest ? serializeReview(latest) : null;
    });
    if (replay) return replay;
    const existing = await tx.dailyReview.findFirst({
      where: { reviewDate: day.start, workspaceId: workspace.id },
    });
    if (existing) {
      throw new ApiError("DAILY_REVIEW_ALREADY_EXISTS", 409, {
        latest: serializeReview(existing),
        conflictFields: ["reviewDate"],
        workbench: "/review/daily",
      });
    }
    const metrics = await getTodaySessionMetrics(day.start, day.end, workspace.id, tx);
    const savedReview = await tx.dailyReview.create({
      data: { reviewDate: day.start, workspaceId: workspace.id, ...createReviewData(input, metrics) },
    });
    await syncReviewMinimumInbox(tx, workspace.id, actorId, savedReview, day.end, input.tomorrowMinimum);
    await refreshWorkspaceCheckInSnapshotForDate(workspace.id, day.start, tx);
    const result = serializeReview(savedReview);
    await recordDailyReviewCommandResult(tx, command, result);
    return result;
  });
}

export async function updateDailyReview(
  id: string,
  input: UpdateReviewInput,
  actorId: string,
): Promise<DailyReviewDto> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = buildPersistentCreateFingerprint("daily-review-update-v1", {
    id,
    expectedRevision: input.expectedRevision,
    ...dailyReviewCommandPayload(input),
  });
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = dailyReviewCommand(actorId, workspace.id, "DAILY_REVIEW_UPDATED", idempotencyKey, requestFingerprint);
    const replay = await replayDailyReviewCommand(tx, command, async () => {
      const latest = await tx.dailyReview.findFirst({ where: { id, workspaceId: workspace.id } });
      return latest ? serializeReview(latest) : null;
    });
    if (replay) return replay;
    const existing = await tx.dailyReview.findFirst({ where: { id, workspaceId: workspace.id } });
    if (!existing) throw new ApiError("DAILY_REVIEW_NOT_FOUND", 404, { workbench: "/review/daily" });
    if (existing.revision !== input.expectedRevision) {
      throw new ApiError("DAILY_REVIEW_REVISION_CONFLICT", 409, {
        latest: serializeReview(existing),
        conflictFields: ["revision"],
        workbench: "/review/daily",
      });
    }
    const day = getStudyDayRange(existing.reviewDate);
    const metrics = await getTodaySessionMetrics(day.start, day.end, workspace.id, tx);
    const updated = await tx.dailyReview.updateMany({
      where: { id, workspaceId: workspace.id, revision: input.expectedRevision },
      data: { ...createReviewData(input, metrics), revision: { increment: 1 } },
    });
    if (updated.count !== 1) {
      const latest = await tx.dailyReview.findFirst({ where: { id, workspaceId: workspace.id } });
      throw new ApiError("DAILY_REVIEW_REVISION_CONFLICT", 409, {
        latest: latest ? serializeReview(latest) : undefined,
        conflictFields: ["revision"],
        workbench: "/review/daily",
      });
    }
    const savedReview = await tx.dailyReview.findUniqueOrThrow({ where: { id } });
    await syncReviewMinimumInbox(tx, workspace.id, actorId, savedReview, day.end, input.tomorrowMinimum);
    await refreshWorkspaceCheckInSnapshotForDate(workspace.id, day.start, tx);
    const result = serializeReview(savedReview);
    await recordDailyReviewCommandResult(tx, command, result);
    return result;
  });
}

export async function getMotivationVault(): Promise<MotivationVaultDto | null> {
  const vault = await prisma.motivationVault.findFirst({
    orderBy: { createdAt: "asc" },
  });

  return vault ? serializeMotivationVault(vault) : null;
}

// 同一次服务端渲染内共享动机封存读取（模拟工作台与阶段草稿共用）；写路径仍读原函数。
export const getMotivationVaultShared = cache(async (): Promise<MotivationVaultDto | null> => getMotivationVault());

export async function saveMotivationVault(
  input: SaveMotivationVaultInput,
  actorId: string,
): Promise<MotivationVaultDto> {
  const data = {
    whyStarted: normalizeOptionalText(input.whyStarted),
    neverReturnTo: normalizeOptionalText(input.neverReturnTo),
    futureSelf: normalizeOptionalText(input.futureSelf),
    messageToFuture: normalizeOptionalText(input.messageToFuture),
    firstSimulationDiary: normalizeOptionalText(input.firstSimulationDiary),
  };
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = buildPersistentCreateFingerprint("motivation-vault-save-v2", {
    expectedUpdatedAt: input.expectedUpdatedAt,
    data,
  });

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(8197, 1101)`;
    const command = {
      actorId,
      workspaceId: `user-global:${actorId}`,
      action: "MOTIVATION_VAULT_SAVED",
      entityType: "MotivationVault",
      idempotencyKey,
      requestFingerprint,
      conflictCode: "MOTIVATION_VAULT_IDEMPOTENCY_CONFLICT",
    };
    const replay = await findPersistentCreateReplay(tx, command);
    if (replay) {
      const snapshot = parseMotivationVaultSnapshot(replay.resultSnapshot);
      if (snapshot) return snapshot;
      const existingResult = await tx.motivationVault.findUnique({ where: { id: replay.resultId } });
      if (!existingResult) throw new ApiError("MOTIVATION_VAULT_IDEMPOTENCY_RESULT_NOT_FOUND", 409);
      return serializeMotivationVault(existingResult);
    }

    const existing = await tx.motivationVault.findFirst({
      orderBy: { createdAt: "asc" },
    });
    const currentUpdatedAt = existing?.updatedAt.toISOString() ?? null;
    if (currentUpdatedAt !== input.expectedUpdatedAt) {
      throw new ApiError("MOTIVATION_VAULT_REVISION_CONFLICT", 409, {
        latest: existing ? serializeMotivationVault(existing) : null,
        conflictFields: collectMotivationVaultConflictFields(input, existing ? serializeMotivationVault(existing) : null),
        workbench: "/settings/profile",
      });
    }
    const vault = existing
      ? await tx.motivationVault.update({ where: { id: existing.id }, data })
      : await tx.motivationVault.create({ data });
    const result = serializeMotivationVault(vault);
    await recordPersistentCreateResult(tx, command, vault.id, {
      resultSnapshot: result as unknown as Prisma.InputJsonObject,
    });
    return result;
  });
}

function collectMotivationVaultConflictFields(
  input: SaveMotivationVaultInput,
  latest: MotivationVaultDto | null,
): string[] {
  const fields = ["updatedAt"];
  if (!latest) return fields;
  const values: Array<[keyof SaveMotivationVaultInput, string | null]> = [
    ["whyStarted", latest.whyStarted],
    ["neverReturnTo", latest.neverReturnTo],
    ["futureSelf", latest.futureSelf],
    ["messageToFuture", latest.messageToFuture],
    ["firstSimulationDiary", latest.firstSimulationDiary],
  ];
  for (const [field, serverValue] of values) {
    if (input[field] !== undefined && normalizeOptionalText(input[field] as string | undefined) !== serverValue) {
      fields.push(field);
    }
  }
  return fields;
}

export async function listSubjects(actorId: string): Promise<SubjectDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const subjects = await prisma.subject.findMany({
    where: { workspaceId: workspace.id, archivedAt: null },
    orderBy: { sortOrder: "asc" },
  });

  return subjects.map(serializeSubject);
}

async function assertSubjectExists(
  subjectId: string,
  workspaceId: string,
  client: StudyDbClient = prisma,
): Promise<void> {
  const subject = await client.subject.findFirst({
    where: { id: subjectId, workspaceId },
    select: { id: true, archivedAt: true },
  });

  if (!subject) {
    throw new ApiError("SUBJECT_NOT_FOUND", 404);
  }
  if (subject.archivedAt) throw new ApiError("SUBJECT_ARCHIVED", 409);
}

interface TaskCommandPreimage extends TaskCasPreimage {
  subjectId: string;
  syllabusNodeId: string | null;
  relatedSyllabusNodeIds: string[];
  stagePlanIds: string[];
  knowledgePointIds: string[];
  parentTaskId: string | null;
  planMilestoneId: string | null;
  title: string;
  priority: DbTaskPriority;
  estimatedMinutes: number;
  actualMinutes: number;
  reviewText: string | null;
  reviewScheduleId: string | null;
}

async function getTaskCommandPreimage(
  tx: Prisma.TransactionClient,
  id: string,
  actorId: string,
): Promise<TaskCommandPreimage> {
  const workspace = await resolveActiveWorkspace(actorId, tx);
  const task = await tx.studyTask.findFirst({
    where: { id, subject: { workspaceId: workspace.id } },
    select: {
      id: true,
      subjectId: true,
      syllabusNodeId: true,
      planMilestoneId: true,
      parentTaskId: true,
      title: true,
      type: true,
      status: true,
      priority: true,
      debtStatus: true,
      plannedDate: true,
      estimatedMinutes: true,
      actualMinutes: true,
      reviewText: true,
      completedAt: true,
      updatedAt: true,
      reviewScheduleId: true,
      relatedSyllabusNodes: {
        select: { syllabusNodeId: true },
        orderBy: { createdAt: "asc" },
      },
      stageLinks: {
        select: { stagePlanId: true },
        orderBy: { createdAt: "asc" },
      },
      knowledgePointLinks: {
        select: { knowledgePointId: true },
        orderBy: { createdAt: "asc" },
      },
      subject: { select: { archivedAt: true } },
    },
  });

  if (!task) throw new ApiError("TASK_NOT_FOUND", 404);
  const { subject, relatedSyllabusNodes, stageLinks, knowledgePointLinks, ...taskPreimage } = task;
  const preimage = {
    ...taskPreimage,
    relatedSyllabusNodeIds: relatedSyllabusNodes.map((relation) => relation.syllabusNodeId),
    stagePlanIds: stageLinks.map((relation) => relation.stagePlanId),
    knowledgePointIds: knowledgePointLinks.map((relation) => relation.knowledgePointId),
  };
  if (subject.archivedAt) throw new ApiError("SUBJECT_ARCHIVED", 409);

  // Read the task preimage before serializing workspace mutations so concurrent
  // commands still race against the same CAS predicate. Revalidate scope after
  // taking the lock to reject a workspace switch or subject archive in between.
  const lockedWorkspace = await lockActiveWorkspaceForWrite(tx, actorId);
  if (lockedWorkspace.id !== workspace.id) {
    throw new ApiError("TASK_STATE_CONFLICT", 409, { conflictFields: ["workspaceId"] });
  }
  const currentSubject = await tx.subject.findFirst({
    where: { id: preimage.subjectId, workspaceId: lockedWorkspace.id },
    select: { archivedAt: true },
  });
  if (!currentSubject) {
    throw new ApiError("TASK_STATE_CONFLICT", 409, { conflictFields: ["workspaceId", "subjectId"] });
  }
  if (currentSubject.archivedAt) throw new ApiError("SUBJECT_ARCHIVED", 409);
  return preimage;
}

async function assertTaskUpdateExpectation(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  existing: TaskCommandPreimage,
  input: Pick<UpdateTaskInput, "expectedStatus" | "expectedUpdatedAt">,
): Promise<void> {
  const conflictFields: string[] = [];
  const expectedStatus = input.expectedStatus.toUpperCase() as DbTaskStatus;
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  if (existing.status !== expectedStatus) conflictFields.push("status");
  if (!Number.isFinite(expectedUpdatedAt.getTime()) || existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    conflictFields.push("updatedAt");
  }
  if (conflictFields.length > 0) {
    throw await taskUpdateConflict(tx, workspaceId, existing.id, conflictFields);
  }
}

async function taskUpdateConflict(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  taskId: string,
  conflictFields: string[],
): Promise<ApiError> {
  const latest = await loadTaskUpdateSnapshotForWorkspace(tx, workspaceId, taskId);
  return new ApiError("TASK_STATE_CONFLICT", 409, {
    latest,
    conflictFields: Array.from(new Set(conflictFields)),
    workbench: "/plan",
  });
}

function normalizeTaskRelatedNodeIds(nodeIds: string[]): string[] {
  if (new Set(nodeIds).size !== nodeIds.length) {
    throw new ApiError("TASK_RELATED_SYLLABUS_DUPLICATE", 400);
  }
  return [...nodeIds].sort();
}

function normalizeTaskStageIds(stagePlanIds: string[]): string[] {
  const normalized = stagePlanIds.map((id) => id.trim()).filter(Boolean);
  if (new Set(normalized).size !== normalized.length) {
    throw new ApiError("TASK_STAGE_DUPLICATE", 400);
  }
  return [...normalized].sort();
}

function normalizeTaskKnowledgePointIds(knowledgePointIds: string[]): string[] {
  const normalized = knowledgePointIds.map((id) => id.trim()).filter(Boolean);
  if (new Set(normalized).size !== normalized.length) {
    throw new ApiError("TASK_KNOWLEDGE_POINT_DUPLICATE", 400);
  }
  return [...normalized].sort();
}

function assertTaskSyllabusRelationsDistinct(primaryNodeId: string | null, relatedNodeIds: string[]): void {
  if (primaryNodeId && relatedNodeIds.includes(primaryNodeId)) {
    throw new ApiError("TASK_PRIMARY_RELATED_SYLLABUS_OVERLAP", 400);
  }
}

async function assertActiveTaskRelations(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  subjectId: string,
  input: { syllabusNodeIds: string[]; planMilestoneId: string | null; stagePlanIds: string[] },
): Promise<void> {
  const syllabusNodeIds = Array.from(new Set(input.syllabusNodeIds));
  if (syllabusNodeIds.length > 0) {
    const nodes = await tx.syllabusNode.findMany({
      where: { id: { in: syllabusNodeIds }, subject: { workspaceId } },
      select: { id: true, subjectId: true, archivedAt: true },
    });
    if (nodes.length !== syllabusNodeIds.length || nodes.some((node) => node.subjectId !== subjectId || node.archivedAt)) {
      throw new ApiError("TASK_SYLLABUS_RELATION_INVALID", 409, {
        conflictFields: ["syllabusNodeId", "relatedSyllabusNodeIds"],
      });
    }
  }
  if (input.planMilestoneId) {
    const milestone = await tx.planMilestone.findFirst({
      where: { id: input.planMilestoneId, workspaceId },
      select: { subjectId: true, archivedAt: true },
    });
    if (!milestone || milestone.archivedAt || (milestone.subjectId && milestone.subjectId !== subjectId)) {
      throw new ApiError("TASK_MILESTONE_INVALID", 409, { conflictFields: ["planMilestoneId"] });
    }
  }
  const stagePlanIds = Array.from(new Set(input.stagePlanIds));
  if (stagePlanIds.length > 0) {
    const stagePlans = await tx.stagePlan.findMany({
      where: { id: { in: stagePlanIds }, workspaceId },
      select: { id: true, status: true },
    });
    if (
      stagePlans.length !== stagePlanIds.length
      || stagePlans.some((stagePlan) => stagePlan.status === "archived")
    ) {
      throw new ApiError("TASK_STAGE_RELATION_INVALID", 409, {
        conflictFields: ["stagePlanIds"],
      });
    }
  }
}

async function assertActiveTaskKnowledgePoints(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  subjectId: string,
  knowledgePointIds: string[],
): Promise<void> {
  if (knowledgePointIds.length === 0) return;
  const points = await tx.knowledgePoint.findMany({
    where: {
      id: { in: knowledgePointIds },
      workspaceId,
      archivedAt: null,
      OR: [
        { primarySubjectId: subjectId },
        { relatedSubjects: { some: { subjectId } } },
      ],
    },
    select: { id: true },
  });
  if (points.length !== knowledgePointIds.length) {
    throw new ApiError("TASK_KNOWLEDGE_POINT_RELATION_INVALID", 409, {
      conflictFields: ["knowledgePointIds"],
    });
  }
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function nextTaskUpdatedAt(current: Date): Date {
  return new Date(Math.max(Date.now(), current.getTime() + 1));
}

function assertTaskSourceStatus(
  task: TaskCommandPreimage,
  allowed: DbTaskStatus[],
  requireIncomplete = false,
): void {
  if (!allowed.includes(task.status) || (requireIncomplete && task.completedAt !== null)) {
    throw new ApiError("TASK_STATE_CONFLICT", 409);
  }
}

async function getUpdatedTaskForResponse(tx: Prisma.TransactionClient, id: string) {
  const task = await tx.studyTask.findUnique({
    where: { id },
    include: {
      subject: true,
      syllabusNode: true,
      stageLinks: { include: { stagePlan: { select: { name: true } } } },
      knowledgePointLinks: { include: { knowledgePoint: { select: { title: true } } } },
    },
  });
  if (!task) throw new ApiError("TASK_STATE_CONFLICT", 409);
  return task;
}

async function getUpdatedSessionForResponse(tx: Prisma.TransactionClient, id: string) {
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

async function getSessionCommandPreimage(
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

async function assertSessionCommandExpectation(
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

async function sessionConflict(tx: Prisma.TransactionClient, id: string, conflictFields: string[]): Promise<ApiError> {
  const latest = await getUpdatedSessionForResponse(tx, id);
  return new ApiError("SESSION_STATE_CONFLICT", 409, { latest: serializeSession(latest), conflictFields });
}

function sessionCommandFingerprint(action: string, input: object): string {
  return createHash("sha256").update(JSON.stringify({ action, input })).digest("hex");
}

async function isReusedSessionCommand(
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

async function auditSessionCommand(
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

async function getTodaySessionMetrics(
  start: Date,
  end: Date,
  workspaceId: string,
  client: StudyDbClient = prisma,
): Promise<{ totalMinutes: number; effectiveMinutes: number }> {
  const sessions = await client.studySession.findMany({
    where: {
      subject: { workspaceId },
      startedAt: {
        gte: start,
        lt: end,
      },
      status: "COMPLETED",
    },
    select: {
      effectiveMinutes: true,
      isEffective: true,
    },
  });

  return {
    totalMinutes: sessions.reduce((total, session) => total + session.effectiveMinutes, 0),
    effectiveMinutes: sessions
      .filter((session) => session.isEffective)
      .reduce((total, session) => total + session.effectiveMinutes, 0),
  };
}

function createReviewData(
  input: ReviewContentInput,
  metrics: { totalMinutes: number; effectiveMinutes: number },
) {
  return {
    totalMinutes: metrics.totalMinutes,
    effectiveMinutes: metrics.effectiveMinutes,
    summary: input.summary,
    lostControl: input.lostControl,
    keepAction: input.keepAction,
    tomorrowMinimum: input.tomorrowMinimum,
    mood: input.mood,
  };
}

function dailyReviewCommandPayload(input: ReviewContentInput) {
  return {
    summary: input.summary,
    lostControl: input.lostControl ?? null,
    keepAction: input.keepAction,
    tomorrowMinimum: input.tomorrowMinimum,
    mood: input.mood ?? null,
  };
}

function parseStudyTaskSnapshot(value: Prisma.JsonValue | undefined): StudyTaskDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return typeof value.id === "string" && typeof value.title === "string"
    ? value as unknown as StudyTaskDto
    : null;
}

function parseDailyReviewSnapshot(value: Prisma.JsonValue | undefined): DailyReviewDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  if (
    typeof snapshot.id !== "string" ||
    typeof snapshot.revision !== "number" ||
    typeof snapshot.reviewDate !== "string" ||
    typeof snapshot.totalMinutes !== "number" ||
    typeof snapshot.effectiveMinutes !== "number"
  ) return null;
  const nullableFields = ["summary", "lostControl", "keepAction", "tomorrowMinimum", "mood", "aiSuggestion"];
  if (!nullableFields.every((field) => snapshot[field] === null || typeof snapshot[field] === "string")) return null;
  return snapshot as unknown as DailyReviewDto;
}

function dailyReviewCommand(
  actorId: string,
  workspaceId: string,
  action: string,
  idempotencyKey: string,
  requestFingerprint: string,
): PersistentCreateCommand {
  return {
    actorId,
    workspaceId,
    action,
    entityType: "DailyReview",
    idempotencyKey,
    requestFingerprint,
    conflictCode: "DAILY_REVIEW_IDEMPOTENCY_CONFLICT",
  };
}

async function replayDailyReviewCommand(
  tx: Prisma.TransactionClient,
  command: PersistentCreateCommand,
  readLatest: () => Promise<DailyReviewDto | null>,
): Promise<DailyReviewDto | null> {
  try {
    const replay = await findPersistentCreateReplay(tx, command);
    if (!replay) return null;
    const snapshot = parseDailyReviewSnapshot(replay.resultSnapshot);
    if (snapshot) return snapshot;
    const existingResult = await tx.dailyReview.findFirst({
      where: { id: replay.resultId, workspaceId: command.workspaceId },
    });
    if (!existingResult) throw new ApiError("DAILY_REVIEW_IDEMPOTENCY_RESULT_NOT_FOUND", 409);
    return serializeReview(existingResult);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    throw new ApiError(error.code, 409, {
      latest: await readLatest(),
      conflictFields: error.details?.conflictFields ?? ["idempotencyKey"],
      workbench: "/review/daily",
    });
  }
}

async function updateTodayReview(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  existing: { id: string; revision: number },
  input: ReviewContentInput,
  metrics: { totalMinutes: number; effectiveMinutes: number },
) {
  const updated = await tx.dailyReview.updateMany({
    where: { id: existing.id, workspaceId, revision: existing.revision },
    data: { ...createReviewData(input, metrics), revision: { increment: 1 } },
  });
  if (updated.count !== 1) {
    const latest = await tx.dailyReview.findFirst({ where: { id: existing.id, workspaceId } });
    throw new ApiError("DAILY_REVIEW_REVISION_CONFLICT", 409, {
      latest: latest ? serializeReview(latest) : null,
      conflictFields: ["revision"],
      workbench: "/review/daily",
    });
  }
  return tx.dailyReview.findUniqueOrThrow({ where: { id: existing.id } });
}

async function recordDailyReviewCommandResult(
  tx: Prisma.TransactionClient,
  command: PersistentCreateCommand,
  result: DailyReviewDto,
): Promise<void> {
  await recordPersistentCreateResult(tx, command, result.id, {
    resultSnapshot: result as unknown as Prisma.InputJsonObject,
  });
}

async function syncReviewMinimumInbox(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
  review: { id: string; revision: number; reviewDate: Date },
  plannedDate: Date,
  tomorrowMinimum: string,
): Promise<void> {
  const originKey = `daily-review:${getStudyDayKey(review.reviewDate)}:minimum`;
  await createPlanInboxItemWithResult(tx, workspaceId, actorId, {
    stableKey: `${originKey}:v${review.revision}`,
    originKey,
    originVersion: review.revision,
    originType: "DAILY_REVIEW_MINIMUM",
    originSnapshot: {
      dailyReviewId: review.id,
      reviewDate: review.reviewDate.toISOString(),
      reviewRevision: review.revision,
    },
    title: tomorrowMinimum.trim(),
    plannedDate: plannedDate.toISOString(),
    estimatedMinutes: 25,
    priority: "MEDIUM",
    type: "focus",
  });
}

async function refreshWorkspaceCheckInsForDates(
  actorId: string,
  targetDates: Array<Date | null | undefined>,
  tx: Prisma.TransactionClient,
): Promise<Map<number, CheckInV2Dto>> {
  const workspace = await resolveActiveWorkspace(actorId, tx);
  const uniqueDays = new Map<number, Date>();
  const refreshed = new Map<number, CheckInV2Dto>();
  for (const targetDate of targetDates) {
    if (!targetDate) continue;
    const day = getStudyDayRange(targetDate);
    uniqueDays.set(day.start.getTime(), day.start);
  }
  for (const targetDate of Array.from(uniqueDays.values()).sort((left, right) => left.getTime() - right.getTime())) {
    refreshed.set(
      targetDate.getTime(),
      await refreshWorkspaceCheckInSnapshotForDate(workspace.id, targetDate, tx),
    );
  }
  return refreshed;
}

function serializeSubject(subject: {
  id: string;
  legacyCode: string | null;
  stableKey: string;
  workspaceId: string | null;
  groupId: string | null;
  name: string;
  color: string;
  sortOrder: number;
  archivedAt?: Date | null;
}): SubjectDto {
  return {
    id: subject.id,
    code: subject.legacyCode ?? subject.stableKey,
    legacyCode: subject.legacyCode,
    stableKey: subject.stableKey,
    workspaceId: subject.workspaceId,
    groupId: subject.groupId,
    name: subject.name,
    color: subject.color,
    sortOrder: subject.sortOrder,
    archivedAt: subject.archivedAt?.toISOString() ?? null,
    legacyScope: subject.workspaceId === null,
  };
}

async function createRuleRecoveryState(input: {
  plan: RecoveryPlan;
  actorId: string | null;
  topTask: StudyTaskDto | null;
  riskState: RiskState;
  debtCount: number;
  missedDays: number;
  effectiveMinutes: number;
  studyDayKey: string;
}): Promise<RecoveryStateRecord> {
  return prisma.$transaction(async (tx) => {
    await lockRecoveryState(tx);
    const activeState = await findActiveRecoveryState(tx);
    if (activeState) return activeState;

    return tx.recoveryState.create({
      data: {
        status: "active",
        triggerType: "rule",
        targetMinutes: normalizeRecoveryTargetMinutes(input.plan.minimumMinutes, 30),
        visibleTaskLimit: normalizeRecoveryVisibleTaskLimit(input.plan.visibleTaskLimit, 1),
        reason: input.plan.reason,
        actorId: input.actorId,
        metadata: {
          source: "dashboard_rule",
          action: input.plan.action,
          riskState: input.riskState,
          debtCount: input.debtCount,
          missedDays: input.missedDays,
          effectiveMinutes: input.effectiveMinutes,
          studyDayKey: input.studyDayKey,
          topTaskId: input.topTask?.id ?? null,
          topTaskTitle: input.topTask?.title ?? null,
        },
      },
    });
  });
}

async function finishRecoveryState(
  id: string,
  status: Exclude<DbRecoveryStateStatus, "active">,
  exitCondition: string | undefined,
  fallbackExitCondition: string,
): Promise<RecoveryStateDto> {
  const state = await prisma.$transaction(async (tx) => {
    await lockRecoveryState(tx);
    const existing = await tx.recoveryState.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new ApiError("RECOVERY_STATE_NOT_FOUND", 404);
    }
    if (existing.status !== "active") {
      if (existing.status === status) return existing;
      throw new ApiError("RECOVERY_STATE_ALREADY_FINISHED", 409);
    }

    return tx.recoveryState.update({
      where: { id },
      data: {
        status,
        endedAt: new Date(),
        exitCondition: normalizeOptionalText(exitCondition) ?? fallbackExitCondition,
      },
    });
  });

  return serializeRecoveryState(state);
}

async function findActiveRecoveryState(client: StudyDbClient = prisma): Promise<RecoveryStateRecord | null> {
  return client.recoveryState.findFirst({
    where: {
      status: "active",
    },
    orderBy: {
      startedAt: "desc",
    },
  });
}

async function lockRecoveryState(client: Prisma.TransactionClient): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(${recoveryStateLockKey})`;
}

function createDashboardRecoveryFromRealtimePlan(plan: RecoveryPlan): TodayDashboardDto["recovery"] {
  return {
    stateId: null,
    source: "realtime_rule",
    active: plan.active,
    status: null,
    triggerType: null,
    minimumMinutes: plan.minimumMinutes,
    targetMinutes: plan.minimumMinutes,
    visibleTaskLimit: plan.visibleTaskLimit,
    reason: plan.reason,
    action: plan.action,
    startedAt: null,
    endedAt: null,
    exitCondition: null,
  };
}

function createDashboardRecoveryFromState(
  state: RecoveryStateRecord,
  topTask: StudyTaskDto | null,
): TodayDashboardDto["recovery"] {
  const status = toRecoveryStateStatus(state.status);
  const targetMinutes = normalizeRecoveryTargetMinutes(state.targetMinutes, 30);

  return {
    stateId: state.id,
    source: "state",
    active: status === "active",
    status,
    triggerType: toRecoveryTriggerType(state.triggerType),
    minimumMinutes: targetMinutes,
    targetMinutes,
    visibleTaskLimit: normalizeRecoveryVisibleTaskLimit(state.visibleTaskLimit, 1),
    reason: state.reason,
    action: createRecoveryStateAction(targetMinutes, topTask),
    startedAt: state.startedAt.toISOString(),
    endedAt: state.endedAt?.toISOString() ?? null,
    exitCondition: state.exitCondition,
  };
}

function serializeRecoveryState(state: RecoveryStateRecord): RecoveryStateDto {
  return {
    id: state.id,
    status: toRecoveryStateStatus(state.status),
    triggerType: toRecoveryTriggerType(state.triggerType),
    startedAt: state.startedAt.toISOString(),
    endedAt: state.endedAt?.toISOString() ?? null,
    targetMinutes: normalizeRecoveryTargetMinutes(state.targetMinutes, 30),
    visibleTaskLimit: normalizeRecoveryVisibleTaskLimit(state.visibleTaskLimit, 1),
    reason: state.reason,
    exitCondition: state.exitCondition,
    actorId: state.actorId,
  };
}

function toRecoveryStateStatus(status: string): DbRecoveryStateStatus {
  switch (status) {
    case "completed":
      return "completed";
    case "canceled":
      return "canceled";
    default:
      return "active";
  }
}

function toRecoveryTriggerType(triggerType: string): DbRecoveryTriggerType {
  return triggerType === "manual" ? "manual" : "rule";
}

function createRecoveryStateAction(targetMinutes: number, topTask: StudyTaskDto | null): string {
  if (topTask) {
    return `今天只压「${topTask.title}」这个最小任务，先完成 ${targetMinutes} 分钟。`;
  }

  return `今天不补过去，先完成 ${targetMinutes} 分钟有效学习。`;
}

function normalizeRecoveryTargetMinutes(value: number | undefined, fallback: number): number {
  return normalizeBoundedInt(value, fallback, 5, 240);
}

function normalizeRecoveryVisibleTaskLimit(value: number | undefined, fallback: number): number {
  return normalizeBoundedInt(value, fallback, 1, 8);
}

function normalizeBoundedInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function createTaskDebtReorder(input: {
  tasks: StudyTaskDto[];
  dayStart: Date;
  pressure: TaskDebtReorderPressure;
  availableMinutes: number;
}): TaskDebtReorderDto {
  const plan = suggestTaskDebtReorder({
    pressure: input.pressure,
    availableMinutes: input.availableMinutes,
    tasks: input.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      subject: task.subjectName,
      priority: task.priority,
      estimatedMinutes: task.estimatedMinutes,
      daysOverdue: getDaysOverdue(task.plannedDate, input.dayStart),
      hasRecentEvidence: task.actualMinutes > 0,
      blocksStageGoal: task.priority === "critical" || task.priority === "high",
      isReviewable: task.type === "review" || task.actualMinutes > 0 || Boolean(task.syllabusNodeId),
    })),
  });
  const taskById = new Map(input.tasks.map((task) => [task.id, task]));

  return {
    pressure: input.pressure,
    availableMinutes: input.availableMinutes,
    summary: plan.summary,
    canAutoApply: plan.canAutoApply,
    requiresUserConfirmation: plan.requiresUserConfirmation,
    suggestions: plan.suggestions.flatMap((suggestion) => {
      const task = taskById.get(suggestion.taskId);
      if (!task) return [];

      return [{
        taskId: suggestion.taskId,
        taskTitle: task.title,
        subjectName: task.subjectName,
        action: suggestion.action,
        reason: suggestion.reason,
        estimatedMinutes: suggestion.estimatedMinutes,
        rank: suggestion.rank,
      }];
    }),
  };
}

function determineDebtReorderPressure(
  riskState: RiskState,
  stagePressure: "low" | "medium" | "high" | "sprint",
  recoveryActive: boolean,
): TaskDebtReorderPressure {
  if (stagePressure === "sprint" || riskState === "sprint") return "sprint";
  if (recoveryActive || riskState === "danger" || riskState === "lost") return "recovery";
  if (stagePressure === "high") return "stage_impact";
  return "normal";
}

function determineDebtReorderAvailableMinutes(
  stagePressure: "low" | "medium" | "high" | "sprint",
  recoveryActive: boolean,
  recoveryMinimumMinutes: number,
): number {
  if (recoveryActive) return recoveryMinimumMinutes;
  if (stagePressure === "sprint") return 240;
  if (stagePressure === "high") return 180;
  return 120;
}

function getDaysOverdue(plannedDate: string, dayStart: Date): number {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((dayStart.getTime() - new Date(plannedDate).getTime()) / dayMs));
}

function serializeSession(session: {
  id: string;
  subjectId: string;
  taskId: string | null;
  syllabusNodeId: string | null;
  status: DbStudySessionStatus;
  startedAt: Date;
  updatedAt: Date;
  pausedAt: Date | null;
  endedAt: Date | null;
  accumulatedPauseSeconds: number;
  effectiveMinutes: number;
  qualityScore: number | null;
  isEffective: boolean | null;
  understandingLevel: string | null;
  minimalOutput: string | null;
  nextAction: string | null;
  producedNote: boolean;
  producedMistake: boolean;
  isLowConversion: boolean | null;
  antiFakeReason: string | null;
  requiredOutput: string | null;
  closeoutVersion: number;
  note: string | null;
  goalMinutes?: number | null;
  startSource?: StudySessionStartSourceDto | null;
  clientDeviceId?: string | null;
  clientDeviceLabel?: string | null;
  lastHeartbeatAt?: Date | null;
  devicePresences?: Array<{
    deviceId: string;
    deviceLabel: string | null;
    lastSeenAt: Date;
  }>;
  knowledgeLinks?: Array<{ knowledgePoint: { id: string; title: string; masteryState: string } }>;
  closeout?: {
    lowReasons: Prisma.JsonValue | null;
    focusLevel: number | null;
    energyLevel: number | null;
    nextDisposition: string | null;
  } | null;
  subject: {
    name: string;
  };
  task?: {
    title: string;
    status: DbTaskStatus;
  } | null;
  syllabusNode?: {
    title: string;
  } | null;
}): StudySessionDto {
  return {
    id: session.id,
    subjectId: session.subjectId,
    subjectName: session.subject.name,
    taskId: session.taskId,
    taskTitle: session.task?.title ?? null,
    taskStatus: session.task ? fromDbTaskStatus(session.task.status) : null,
    syllabusNodeId: session.syllabusNodeId,
    syllabusNodeTitle: session.syllabusNode?.title ?? null,
    knowledgePoints: (session.knowledgeLinks ?? []).map(({ knowledgePoint }) => ({
      id: knowledgePoint.id,
      title: knowledgePoint.title,
      masteryState: knowledgePoint.masteryState as StudySessionKnowledgePointDto["masteryState"],
    })),
    status: fromDbSessionStatus(session.status),
    startedAt: session.startedAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    pausedAt: session.pausedAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
    accumulatedPauseSeconds: session.accumulatedPauseSeconds,
    effectiveMinutes: session.effectiveMinutes,
    qualityScore: session.qualityScore,
    isEffective: session.isEffective,
    understandingLevel: session.understandingLevel,
    minimalOutput: session.minimalOutput,
    nextAction: session.nextAction,
    producedNote: session.producedNote,
    producedMistake: session.producedMistake,
    isLowConversion: session.isLowConversion,
    antiFakeReason: session.antiFakeReason,
    requiredOutput: session.requiredOutput,
    closeoutVersion: session.closeoutVersion,
    note: session.note,
    goalMinutes: session.goalMinutes ?? null,
    startSource: session.startSource ?? null,
    clientDeviceId: session.clientDeviceId ?? null,
    clientDeviceLabel: session.clientDeviceLabel ?? null,
    lastHeartbeatAt: session.lastHeartbeatAt?.toISOString() ?? null,
    devicePresences: session.status === "RUNNING" || session.status === "PAUSED" || session.status === "CLOSING"
      ? (session.devicePresences ?? [])
        .filter((presence) => Date.now() - presence.lastSeenAt.getTime() <= DEVICE_PRESENCE_STALE_MS)
        .sort((left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime())
        .map((presence) => ({
          deviceId: presence.deviceId,
          deviceLabel: presence.deviceLabel ?? "其他设备",
          lastSeenAt: presence.lastSeenAt.toISOString(),
          isCurrentDevice: presence.deviceId === session.clientDeviceId,
        }))
      : [],
    lowReasons: parseLowReasons(session.closeout?.lowReasons),
    focusLevel: session.closeout?.focusLevel ?? null,
    energyLevel: session.closeout?.energyLevel ?? null,
    nextDisposition: session.closeout?.nextDisposition ?? null,
  };
}

const DEVICE_PRESENCE_STALE_MS = 90_000;

function normalizeDeviceId(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return /^[A-Za-z0-9:_-]{8,100}$/.test(normalized) ? normalized : null;
}

function normalizeDeviceLabel(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized.length > 0 ? normalized.slice(0, 80) : null;
}

function parseLowReasons(value: Prisma.JsonValue | null | undefined): StudySessionLowReasonDto[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<StudySessionLowReasonDto>([
    "NOT_UNDERSTOOD",
    "DISTRACTED",
    "MATERIAL_BLOCKED",
    "FATIGUE",
    "METHOD_MISMATCH",
    "TIME_FRAGMENTED",
    "OTHER",
  ]);
  return value.filter((item): item is StudySessionLowReasonDto => typeof item === "string" && allowed.has(item as StudySessionLowReasonDto));
}

function toCloseoutUnderstanding(value: string): "NO_PROGRESS" | "SOME_PROGRESS" | "UNDERSTOOD" | "CAN_APPLY" {
  if (value === "清晰") return "CAN_APPLY";
  if (value === "基本理解") return "UNDERSTOOD";
  if (value === "模糊") return "SOME_PROGRESS";
  return "NO_PROGRESS";
}

function toCloseoutEfficiency(isEffective: boolean, qualityScore?: number): "LOW" | "NORMAL" | "HIGH" {
  if (!isEffective) return "LOW";
  return (qualityScore ?? 3) >= 4 ? "HIGH" : "NORMAL";
}

function toCheckInSnapshotSession(session: StudySessionDto) {
  return {
    effectiveMinutes: session.effectiveMinutes,
    isEffective: session.isEffective,
    isLowConversion: session.isLowConversion,
  };
}

function getLatestCompletedSession(sessions: StudySessionDto[]): StudySessionDto | null {
  return sessions.reduce<StudySessionDto | null>((latest, session) => {
    if (session.status !== "completed") return latest;
    if (!latest) return session;
    return getSessionEndTime(session) > getSessionEndTime(latest) ? session : latest;
  }, null);
}

function getSessionEndTime(session: StudySessionDto): number {
  return Date.parse(session.endedAt ?? session.startedAt);
}

function serializeReview(review: {
  id: string;
  revision: number;
  reviewDate: Date;
  totalMinutes: number;
  effectiveMinutes: number;
  summary: string | null;
  lostControl: string | null;
  keepAction: string | null;
  tomorrowMinimum: string | null;
  mood: string | null;
  aiSuggestion: string | null;
}): DailyReviewDto {
  return {
    id: review.id,
    revision: review.revision,
    reviewDate: review.reviewDate.toISOString(),
    totalMinutes: review.totalMinutes,
    effectiveMinutes: review.effectiveMinutes,
    summary: review.summary,
    lostControl: review.lostControl,
    keepAction: review.keepAction,
    tomorrowMinimum: review.tomorrowMinimum,
    mood: review.mood,
    aiSuggestion: review.aiSuggestion,
  };
}

function serializeMotivationVault(vault: {
  id: string;
  whyStarted: string | null;
  neverReturnTo: string | null;
  futureSelf: string | null;
  messageToFuture: string | null;
  firstSimulationDiary: string | null;
  createdAt: Date;
  updatedAt: Date;
}): MotivationVaultDto {
  return {
    id: vault.id,
    whyStarted: vault.whyStarted,
    neverReturnTo: vault.neverReturnTo,
    futureSelf: vault.futureSelf,
    messageToFuture: vault.messageToFuture,
    firstSimulationDiary: vault.firstSimulationDiary,
    createdAt: vault.createdAt.toISOString(),
    updatedAt: vault.updatedAt.toISOString(),
  };
}

function parseMotivationVaultSnapshot(value: Prisma.JsonValue | undefined): MotivationVaultDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  if (
    typeof snapshot.id !== "string" ||
    typeof snapshot.createdAt !== "string" ||
    typeof snapshot.updatedAt !== "string"
  ) return null;
  const nullableFields = ["whyStarted", "neverReturnTo", "futureSelf", "messageToFuture", "firstSimulationDiary"];
  if (!nullableFields.every((field) => snapshot[field] === null || typeof snapshot[field] === "string")) return null;
  return snapshot as unknown as MotivationVaultDto;
}

function serializeSyllabusOverview(subject: {
  name: string;
  color: string;
  syllabusNodes: Array<{
    status: string;
  }>;
}): SyllabusOverviewDto {
  const total = subject.syllabusNodes.length;
  const covered = subject.syllabusNodes.filter((node) => node.status === "COVERED" || node.status === "MASTERED").length;

  return {
    label: subject.name,
    progress: total === 0 ? 0 : Math.round((covered / total) * 100),
    color: subject.color,
  };
}

function getOverallSyllabusProgress(subjects: Array<{
  syllabusNodes: Array<{
    status: string;
  }>;
}>): number {
  const nodes = subjects.flatMap((subject) => subject.syllabusNodes);
  if (nodes.length === 0) return 0;

  const covered = nodes.filter((node) => node.status === "COVERED" || node.status === "MASTERED").length;
  return covered / nodes.length;
}

function toCoreTask(task: StudyTaskDto): StudyTaskInput {
  return {
    id: task.id,
    title: task.title,
    subject: task.subjectName,
    type: task.type,
    status: task.status,
    estimatedMinutes: task.estimatedMinutes,
    actualMinutes: task.actualMinutes,
    priority: task.priority,
  };
}

function getRecoveryTaskCandidates(todayTasks: StudyTaskDto[], debtTasks: StudyTaskDto[]): StudyTaskDto[] {
  const byId = new Map([...debtTasks, ...todayTasks].map((task) => [task.id, task]));
  return rankRecoveryTaskCandidates({
    todayTasks: todayTasks.map(toRecoveryTaskCandidate),
    debtTasks: debtTasks.map(toRecoveryTaskCandidate),
  })
    .map((candidate) => byId.get(candidate.id))
    .filter((task): task is StudyTaskDto => Boolean(task));
}

function toRecoveryTaskCandidate(task: StudyTaskDto) {
  return {
    id: task.id,
    title: task.title,
    subject: task.subjectName,
    status: task.status,
    priority: task.priority,
    estimatedMinutes: task.estimatedMinutes,
    actualMinutes: task.actualMinutes,
  };
}

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function isMajorReview(review: { summary: string | null; lostControl: string | null } | null): boolean {
  if (!review) return false;

  const text = `${review.summary ?? ""}\n${review.lostControl ?? ""}`.trim();
  if (text.length < 24) return false;

  return /重大|失控|崩|断签|放弃|危险|拖延|熬夜|崩盘/.test(text);
}

function sumTodayMinutes(sessions: StudySessionDto[], activeSession: StudySessionDto | null, now: Date): number {
  const completedMinutes = sessions.reduce((total, session) => total + session.effectiveMinutes, 0);
  if (!activeSession || activeSession.status === "completed" || activeSession.status === "canceled" || activeSession.status === "closing") {
    return completedMinutes;
  }

  const activeSeconds = getTimerElapsedSeconds({
    status: activeSession.status === "running" ? "running" : "paused",
    startedAt: new Date(activeSession.startedAt),
    pausedAt: activeSession.pausedAt ? new Date(activeSession.pausedAt) : undefined,
    accumulatedPauseSeconds: activeSession.accumulatedPauseSeconds,
    now,
  });

  return completedMinutes + Math.floor(activeSeconds / 60);
}

function sumEffectiveMinutesByStudyDay(
  start: Date,
  days: number,
  sessions: Array<{
    startedAt: Date;
    effectiveMinutes: number;
  }>,
  checkInSnapshots: Map<string, { effectiveMinutes: number }>,
): number {
  let total = 0;

  for (let index = 0; index < days; index += 1) {
    const day = getStudyDayRange(new Date(start.getTime() + index * 24 * 60 * 60 * 1000));
    const snapshot = checkInSnapshots.get(day.key);
    total += snapshot
      ? snapshot.effectiveMinutes
      : sessions
          .filter((session) => session.startedAt >= day.start && session.startedAt < day.end)
          .reduce((sum, session) => sum + session.effectiveMinutes, 0);
  }

  return total;
}

function getEffectiveStudyStreak(
  sessions: Array<{
    startedAt: Date;
  }>,
  checkInSnapshots: Map<string, { effectiveMinutes: number }>,
  now: Date,
): number {
  const studiedDays = new Set(sessions.map((session) => getStudyDayKey(session.startedAt)));
  let cursor = getStudyDayRange(now).start;
  let streak = 0;

  for (let index = 0; index < 60; index += 1) {
    const key = getStudyDayKey(cursor);
    const snapshot = checkInSnapshots.get(key);
    const studied = snapshot ? snapshot.effectiveMinutes > 0 : studiedDays.has(key);
    if (!studied) {
      return streak;
    }

    streak += 1;
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }

  return streak;
}

function fromDbSessionStatus(status: DbStudySessionStatus): "running" | "paused" | "closing" | "completed" | "canceled" {
  return status.toLowerCase() as "running" | "paused" | "closing" | "completed" | "canceled";
}

function mergeTaskReviewText(existing: string | null, note: string | undefined, fallback: string): string {
  const addition = note?.trim() || fallback;
  const merged = existing?.trim() ? `${existing.trim()}\n${addition}` : addition;
  return merged.slice(0, 2000);
}

function normalizeTaskDebtReason(note: string | undefined, fallback: string): string {
  const normalized = note?.trim() ?? "";
  return normalized.length > 0 ? normalized.slice(0, 1000) : fallback;
}

function toTaskDebtEventState(task: {
  status: DbTaskStatus;
  debtStatus: string;
}) {
  return {
    status: task.status,
    debtStatus: task.debtStatus,
  };
}

async function audit(
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  client: StudyDbClient = prisma,
): Promise<void> {
  await client.auditEvent.create({
    data: {
      actorId,
      action,
      entityType,
      entityId,
    },
  });
}
