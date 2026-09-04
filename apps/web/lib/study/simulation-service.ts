import {
  draftStageAdjustment,
  evaluateSimulationReadiness,
  summarizeSimulationResult,
  buildSimulationRemediationGroups,
  buildSimulationRemediationOriginSnapshot,
  summarizeSimulationScores,
  type SimulationLossReason,
  type StageAdjustmentDraft,
  type SimulationReadinessSummary,
  type SimulationResultSummary,
} from "@areaforge/core";
import { prisma, type Prisma, type PrismaClient } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type {
  SimulationRemediationDto,
  SimulationStageDraftDto,
  SimulationWorkspaceDto,
} from "@/lib/contracts/simulation";
import { getAnalyticsSummary } from "./analytics-service";
import { refreshCheckInSnapshotsForDates } from "./check-in-service";
import { applyTaskCas } from "./concurrency";
import { getStudyDayRange, optionalDaysUntil } from "./date";
import { completeConfiguredActivitySessionInTx } from "./session-command-service";
import { getMotivationVault, getMotivationVaultShared, saveMotivationVault } from "./motivation-vault-service";
import { activeTimerSessionId } from "./activity-session-state";
import { listStageAdjustmentDrafts, listStagePlans } from "./stage-service";
import { assertSyllabusNodeBelongsToSubject } from "./syllabus-service";
import { createTaskDebtEvent } from "./task-debt-event-service";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import { createPlanInboxItemWithResult } from "./plan-inbox-service";
import {
  buildPersistentCreateFingerprint,
  findPersistentCreateReplay,
  normalizeIdempotencyKey,
  recordPersistentCreateResult,
} from "./persistent-idempotency";
import { serializeTask } from "./task-serializer";
import type {
  MotivationVaultDto,
  SimulationExamDto,
  SimulationLossItemDto,
  StudyTaskDto,
} from "@/lib/contracts";

export type {
  SimulationRemediationDto,
  SimulationStageDraftDto,
  SimulationWorkspaceDto,
} from "@/lib/contracts/simulation";

type DbTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED";
type SimulationDbClient = PrismaClient | Prisma.TransactionClient;

const simulationExamInclude = {
  studySessions: {
    where: { status: { in: ["RUNNING", "PAUSED", "CLOSING"] } },
    select: { id: true, status: true },
    orderBy: { startedAt: "desc" },
    take: 1,
  },
  subjectResults: {
    include: { subject: true, lossItems: { include: { syllabusNode: true }, orderBy: { createdAt: "asc" } } },
    orderBy: { subjectId: "asc" },
  },
} satisfies Prisma.SimulationExamInclude;

export interface CreateSimulationTaskInput {
  subjectId: string;
  syllabusNodeId?: string | null;
  title: string;
  plannedDate: string;
  estimatedMinutes: number;
}

export interface CompleteSimulationTaskInput {
  targetScore?: string;
  actualScore?: string;
  durationMinutes?: number;
  blankCount?: number;
  lossReason?: string;
  mindset?: string;
  summary: string;
}

export interface CreateSimulationExamInput {
  idempotencyKey: string;
  name: string;
  examDate: string;
  isFirstSynchronized?: boolean;
  targetDurationMinutes?: number;
  targetScore?: number;
}

export interface SimulationSubjectResultInput {
  subjectId: string;
  expectedRevision?: number;
  paperFullScore: number | null;
  targetScore: number | null;
  actualScore: number | null;
  durationMinutes?: number | null;
  blankQuestionCount: number;
  lossReasons: string[];
  summary?: string;
  lossItems?: Array<{
    reason: SimulationLossReason;
    syllabusNodeId?: string | null;
    lostScore: number;
    note?: string | null;
  }>;
}

export interface SaveSimulationExamResultsInput {
  expectedRevision: number;
  targetDurationMinutes?: number;
  actualDurationMinutes?: number;
  targetScore?: number;
  actualScore?: number;
  blankQuestionCount?: number;
  lossReasons: string[];
  mindset?: string;
  summary: string;
  reviewText: string;
  subjectResults: SimulationSubjectResultInput[];
}

export interface SaveSimulationLossItemInput {
  idempotencyKey: string;
  expectedExamRevision?: number;
  expectedSubjectResultRevision?: number;
  reason: SimulationLossReason;
  syllabusNodeId?: string | null;
  lostScore: number;
  note?: string | null;
}

export interface SimulationLossItemMutationResult {
  lossItem: SimulationLossItemDto;
  versions: {
    subjectResultRevision: number;
    examRevision: number;
    examStatus: SimulationExamDto["status"];
  };
}

export async function getSimulationWorkspace(actorId: string, now = new Date()): Promise<SimulationWorkspaceDto> {
  const [exams, tasks, stage, stagePlans, stageAdjustmentDrafts, motivationVault] = await Promise.all([
    listSimulationExams(actorId),
    listSimulationTasks(actorId),
    getSimulationStageDraft(actorId, now),
    listStagePlans(actorId),
    listStageAdjustmentDrafts(actorId),
    getMotivationVaultShared(),
  ]);

  return { exams, tasks, stage, stagePlans, stageAdjustmentDrafts, motivationVault };
}

export async function listSimulationExams(actorId?: string): Promise<SimulationExamDto[]> {
  const workspace = actorId ? await resolveActiveWorkspace(actorId) : null;
  const exams = await prisma.simulationExam.findMany({
    where: workspace ? { workspaceId: workspace.id } : undefined,
    include: simulationExamInclude,
    orderBy: [{ examDate: "desc" }, { createdAt: "desc" }],
    take: 100,
  });

  return exams.map(serializeSimulationExam);
}

export async function getSimulationExam(id: string, actorId: string): Promise<SimulationExamDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const exam = await prisma.simulationExam.findFirst({
    where: { id, workspaceId: workspace.id },
    include: simulationExamInclude,
  });
  if (!exam) throw new ApiError("SIMULATION_EXAM_NOT_FOUND", 404);
  return serializeSimulationExam(exam);
}

export async function createSimulationExam(
  input: CreateSimulationExamInput,
  actorId: string,
): Promise<SimulationExamDto> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const examDate = new Date(input.examDate);
  const requestFingerprint = buildPersistentCreateFingerprint("simulation-exam-create-v1", {
    name: input.name,
    examDate: input.examDate ?? null,
    isFirstSynchronized: input.isFirstSynchronized ?? null,
    targetDurationMinutes: input.targetDurationMinutes ?? null,
    targetScore: input.targetScore ?? null,
  });
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = {
      actorId,
      workspaceId: workspace.id,
      action: "SIMULATION_EXAM_CREATED",
      entityType: "SimulationExam",
      idempotencyKey,
      requestFingerprint,
      conflictCode: "SIMULATION_EXAM_IDEMPOTENCY_CONFLICT",
    };
    const replay = await findPersistentCreateReplay(tx, command);
    if (replay) {
      const snapshot = parseSimulationExamSnapshot(replay.resultSnapshot);
      if (snapshot) return snapshot;
      const storedExam = await tx.simulationExam.findFirst({
        where: { id: replay.resultId, workspaceId: workspace.id },
        include: simulationExamInclude,
      });
      if (!storedExam) throw new ApiError("SIMULATION_EXAM_IDEMPOTENCY_RESULT_UNAVAILABLE", 409);
      return serializeSimulationExam(storedExam);
    }

    const created = await tx.simulationExam.create({
      data: {
        workspaceId: workspace.id,
        name: input.name,
        examDate,
        isFirstSynchronized: input.isFirstSynchronized ?? false,
        targetDurationMinutes: input.targetDurationMinutes,
        targetScore: input.targetScore,
      },
      include: simulationExamInclude,
    });

    const result = serializeSimulationExam(created);
    await recordPersistentCreateResult(tx, command, created.id, {
      examDate: created.examDate.toISOString(),
      resultSnapshot: result as unknown as Prisma.InputJsonObject,
    });
    return result;
  });
}

export interface StartSimulationExamInput {
  idempotencyKey: string;
  expectedRevision: number;
}

export async function startSimulationExam(
  id: string,
  input: StartSimulationExamInput,
  actorId: string,
): Promise<SimulationExamDto> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = buildPersistentCreateFingerprint("simulation-exam-start-v1", {
    id,
    expectedRevision: input.expectedRevision,
  });
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const command = {
      actorId,
      workspaceId: workspace.id,
      action: "SIMULATION_EXAM_STARTED",
      entityType: "SimulationExam",
      idempotencyKey,
      requestFingerprint,
      conflictCode: "SIMULATION_EXAM_START_IDEMPOTENCY_CONFLICT",
    };
    const replay = await findPersistentCreateReplay(tx, command);
    if (replay) {
      const snapshot = parseSimulationExamSnapshot(replay.resultSnapshot);
      if (snapshot) return snapshot;
    }
    const existing = await tx.simulationExam.findFirst({
      where: { id, workspaceId: workspace.id },
      include: simulationExamInclude,
    });
    if (!existing) throw new ApiError("SIMULATION_EXAM_NOT_FOUND", 404);
    if (existing.status === "IN_PROGRESS" && existing.studySessions.length > 0) return serializeSimulationExam(existing);
    if (existing.status !== "DRAFT" && existing.status !== "IN_PROGRESS") {
      throw new ApiError("SIMULATION_EXAM_START_INVALID_STATE", 409, { conflictFields: ["status"] });
    }
    if (existing.revision !== input.expectedRevision) {
      throw new ApiError("SIMULATION_EXAM_REVISION_CONFLICT", 409, {
        latest: serializeSimulationExam(existing),
        conflictFields: ["revision"],
      });
    }
    const firstSubject = existing.subjectResults.find((result) => !result.subject.archivedAt);
    if (!firstSubject) throw new ApiError("SIMULATION_SUBJECT_RESULTS_REQUIRED", 400);
    const active = await tx.studySession.findFirst({
      where: { userId: actorId, workspaceId: workspace.id, status: { in: ["RUNNING", "PAUSED", "CLOSING"] } },
      select: { id: true },
    });
    if (active) throw new ApiError("ACTIVE_SESSION_EXISTS", 409, { conflictFields: ["status"] });
    const now = new Date();
    await tx.studySession.create({
      data: {
        userId: actorId,
        workspaceId: workspace.id,
        subjectId: firstSubject.subjectId,
        activityKind: "TEST",
        activityMode: "SIMULATION",
        simulationExamId: id,
        status: "RUNNING",
        startedAt: now,
        goalMinutes: existing.targetDurationMinutes,
        startSource: "SIMULATION_EXAM",
        lastHeartbeatAt: now,
      },
    });
    await tx.simulationExam.update({ where: { id }, data: { status: "IN_PROGRESS", revision: { increment: 1 } } });
    await audit(actorId, "SIMULATION_EXAM_STARTED", "SimulationExam", id, tx);
    const result = serializeSimulationExam(await tx.simulationExam.findUniqueOrThrow({ where: { id }, include: simulationExamInclude }));
    await recordPersistentCreateResult(tx, command, id, { resultSnapshot: result as unknown as Prisma.InputJsonObject });
    return result;
  });
}

export async function saveSimulationExamResults(
  id: string,
  input: SaveSimulationExamResultsInput,
  actorId: string,
): Promise<SimulationExamDto> {
  const exam = await prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const existing = await tx.simulationExam.findFirst({
      where: { id, workspaceId: workspace.id },
      include: simulationExamInclude,
    });
    if (!existing) {
      throw new ApiError("SIMULATION_EXAM_NOT_FOUND", 404);
    }
    if (existing.status !== "DRAFT" && existing.status !== "IN_PROGRESS") {
      throw new ApiError("SIMULATION_EXAM_CONFIRMED", 409, {
        latest: serializeSimulationExam(existing),
        conflictFields: ["status"],
      });
    }
    const timerSession = existing.studySessions[0] ?? null;
    if (timerSession && timerSession.status !== "CLOSING") {
      throw new ApiError("SIMULATION_TIMER_NOT_CLOSED", 409, { conflictFields: ["timerSessionId"] });
    }
    const reviewText = normalizeOptionalText(input.reviewText);
    if (timerSession && !reviewText) {
      throw new ApiError("SIMULATION_REVIEW_REQUIRED", 400, { conflictFields: ["reviewText"] });
    }
    if (input.expectedRevision !== existing.revision) {
      throw new ApiError("SIMULATION_EXAM_REVISION_CONFLICT", 409, {
        latest: serializeSimulationExam(existing),
        conflictFields: ["revision"],
      });
    }

    assertUniqueSubjectResults(input.subjectResults);
    if (existing.subjectResults.some((result) => result.subject.archivedAt)) {
      throw new ApiError("SUBJECT_ARCHIVED", 409, {
        latest: serializeSimulationExam(existing),
        conflictFields: ["subjectResults.subjectId"],
      });
    }
    await assertSubjectsExist(
      input.subjectResults.map((result) => result.subjectId),
      workspace.id,
      tx,
      { latest: serializeSimulationExam(existing), conflictFields: ["subjectResults.subjectId"] },
    );
    await assertSimulationLossNodes(input.subjectResults, tx);
    const currentSubjectResults = existing.subjectResults;
    const currentSubjectResultBySubjectId = new Map(currentSubjectResults.map((result) => [result.subjectId, result]));
    for (const result of input.subjectResults) {
      const current = currentSubjectResultBySubjectId.get(result.subjectId);
      const revisionMatches = current
        ? result.expectedRevision === current.revision
        : result.expectedRevision == null;
      if (!revisionMatches) {
        throw new ApiError("SIMULATION_SUBJECT_REVISION_CONFLICT", 409, {
          latest: serializeSimulationExam(existing),
          conflictFields: [`subjectResults.${result.subjectId}.revision`],
        });
      }
    }

    const targetDurationMinutes = input.targetDurationMinutes ?? existing.targetDurationMinutes;
    const actualDurationMinutes = input.actualDurationMinutes ?? sumComplete(input.subjectResults, "durationMinutes");
    const targetScore = sumComplete(input.subjectResults, "targetScore");
    const actualScore = sumComplete(input.subjectResults, "actualScore");
    const blankQuestionCount =
      input.blankQuestionCount ?? input.subjectResults.reduce((total, result) => total + result.blankQuestionCount, 0);
    const lossReasons = normalizeLossReasons([
      ...input.lossReasons,
      ...input.subjectResults.flatMap((result) => result.lossReasons),
    ]);
    const examUpdate = await tx.simulationExam.updateMany({
      where: { id, workspaceId: workspace.id, revision: input.expectedRevision },
      data: {
        targetDurationMinutes,
        actualDurationMinutes,
        targetScore,
        actualScore,
        blankQuestionCount,
        lossReasons,
        mindset: normalizeOptionalText(input.mindset),
        summary: input.summary,
        reviewText,
        revision: { increment: 1 },
      },
    });
    if (examUpdate.count !== 1) {
      throw new ApiError("SIMULATION_EXAM_REVISION_CONFLICT", 409, {
        latest: await loadSimulationExamDto(tx, id, workspace.id),
        conflictFields: ["revision"],
      });
    }

    for (const result of input.subjectResults) {
      const current = currentSubjectResultBySubjectId.get(result.subjectId);
      let savedResult: { id: string; revision: number };
      if (!current) {
        savedResult = await tx.simulationSubjectResult.create({
          data: {
            simulationExamId: id,
            subjectId: result.subjectId,
            paperFullScore: result.paperFullScore,
            targetScore: result.targetScore,
            actualScore: result.actualScore,
            durationMinutes: result.durationMinutes,
            blankQuestionCount: result.blankQuestionCount,
            lossReasons: result.lossReasons,
            summary: normalizeOptionalText(result.summary),
          },
          select: { id: true, revision: true },
        });
      } else {
        const subjectUpdate = await tx.simulationSubjectResult.updateMany({
          where: { id: current.id, revision: result.expectedRevision },
          data: {
            paperFullScore: result.paperFullScore,
            targetScore: result.targetScore,
            actualScore: result.actualScore,
            durationMinutes: result.durationMinutes,
            blankQuestionCount: result.blankQuestionCount,
            lossReasons: result.lossReasons,
            summary: normalizeOptionalText(result.summary),
            revision: { increment: 1 },
          },
        });
        if (subjectUpdate.count !== 1) {
          throw new ApiError("SIMULATION_SUBJECT_REVISION_CONFLICT", 409, {
            latest: await loadSimulationExamDto(tx, id, workspace.id),
            conflictFields: [`subjectResults.${result.subjectId}.revision`],
          });
        }
        savedResult = { id: current.id, revision: current.revision + 1 };
      }
      if (result.lossItems !== undefined) {
        await tx.simulationLossItem.updateMany({
          where: { simulationSubjectResultId: savedResult.id, archivedAt: null },
          data: { archivedAt: new Date(), revision: { increment: 1 } },
        });
        if (result.lossItems.length > 0) {
          await tx.simulationLossItem.createMany({
            data: result.lossItems.map((item) => ({
              simulationSubjectResultId: savedResult.id,
              reason: item.reason,
              syllabusNodeId: item.syllabusNodeId ?? null,
              lostScore: item.lostScore,
              note: normalizeOptionalText(item.note ?? undefined),
            })),
          });
        }
      }
    }

    if (timerSession) {
      await completeConfiguredActivitySessionInTx(tx, {
        actorId,
        workspaceId: workspace.id,
        sessionId: timerSession.id,
        activityMode: "SIMULATION",
        minimalOutput: `模拟考试「${existing.name}」成绩与失分已提交。`,
        nextAction: "进入确认中心确认模拟考试结果",
      });
    }

    await audit(actorId, "SIMULATION_EXAM_RESULTS_SAVED", "SimulationExam", id, tx);
    const upgradedLegacy = currentSubjectResults.length === 0 && (
      existing.targetScore != null || existing.actualScore != null || existing.lossReasons != null
    );
    if (upgradedLegacy) {
      await audit(actorId, "SIMULATION_LEGACY_RESULTS_UPGRADED", "SimulationExam", id, tx);
    }

    return tx.simulationExam.findUniqueOrThrow({
      where: { id },
      include: simulationExamInclude,
    });
  });

  return serializeSimulationExam(exam);
}

export async function confirmSimulationExam(
  id: string,
  expectedRevision: number,
  actorId: string,
): Promise<SimulationExamDto> {
  const exam = await prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const existing = await tx.simulationExam.findFirst({
      where: { id, workspaceId: workspace.id },
      include: simulationExamInclude,
    });
    if (!existing) throw new ApiError("SIMULATION_EXAM_NOT_FOUND", 404);
    if (existing.subjectResults.some((result) => result.subject.archivedAt)) {
      throw new ApiError("SUBJECT_ARCHIVED", 409, {
        latest: serializeSimulationExam(existing),
        conflictFields: ["subjectResults.subjectId"],
      });
    }
    if (existing.status === "CONFIRMED") return existing;
    if (existing.revision !== expectedRevision) {
      throw new ApiError("SIMULATION_EXAM_REVISION_CONFLICT", 409, {
        latest: serializeSimulationExam(existing),
        conflictFields: ["revision"],
      });
    }
    if (existing.subjectResults.length === 0) {
      throw new ApiError("SIMULATION_SUBJECT_RESULTS_REQUIRED", 400);
    }
    if (existing.subjectResults.some((result) => result.actualScore == null)) {
      throw new ApiError("SIMULATION_ACTUAL_SCORES_REQUIRED", 400, {
        conflictFields: ["subjectResults.actualScore"],
      });
    }
    if (!existing.summary?.trim() || !existing.reviewText?.trim()) {
      throw new ApiError("SIMULATION_REVIEW_REQUIRED", 400, {
        conflictFields: ["summary", "reviewText"],
      });
    }
    if (!existing.mindset?.trim()) {
      throw new ApiError("SIMULATION_PERSONAL_FEEDBACK_REQUIRED", 400, {
        conflictFields: ["mindset"],
      });
    }
    const confirmedAt = new Date();
    const changed = await tx.simulationExam.updateMany({
      where: { id, workspaceId: workspace.id, status: { in: ["DRAFT", "IN_PROGRESS"] }, revision: expectedRevision },
      data: { status: "CONFIRMED", confirmedAt, revision: { increment: 1 } },
    });
    if (changed.count !== 1) {
      throw new ApiError("SIMULATION_EXAM_REVISION_CONFLICT", 409, {
        latest: await loadSimulationExamDto(tx, id, workspace.id),
        conflictFields: ["revision", "status"],
      });
    }
    await audit(actorId, "SIMULATION_EXAM_CONFIRMED", "SimulationExam", id, tx);
    return tx.simulationExam.findUniqueOrThrow({
      where: { id },
      include: simulationExamInclude,
    });
  });
  return serializeSimulationExam(exam);
}

export async function listSimulationLossItems(subjectResultId: string, actorId: string) {
  const workspace = await resolveActiveWorkspace(actorId);
  const result = await loadOwnedSubjectResult(subjectResultId, workspace.id);
  return result.lossItems.map(serializeLossItem);
}

export async function createSimulationLossItem(
  subjectResultId: string,
  input: SaveSimulationLossItemInput,
  actorId: string,
) {
  return (await createSimulationLossItemCommand(subjectResultId, input, actorId)).lossItem;
}

export async function createSimulationLossItemCommand(
  subjectResultId: string,
  input: SaveSimulationLossItemInput,
  actorId: string,
): Promise<SimulationLossItemMutationResult> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = buildPersistentCreateFingerprint("simulation-loss-item-create-v1", {
    subjectResultId,
    expectedExamRevision: input.expectedExamRevision ?? null,
    expectedSubjectResultRevision: input.expectedSubjectResultRevision ?? null,
    reason: input.reason,
    syllabusNodeId: input.syllabusNodeId ?? null,
    lostScore: input.lostScore,
    note: input.note ?? null,
  });
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const result = await loadOwnedSubjectResult(subjectResultId, workspace.id, tx);
    const command = {
      actorId,
      workspaceId: workspace.id,
      action: "SIMULATION_LOSS_ITEM_CREATED",
      entityType: "SimulationLossItem",
      idempotencyKey,
      requestFingerprint,
      conflictCode: "SIMULATION_LOSS_ITEM_IDEMPOTENCY_CONFLICT",
    };
    const replay = await findPersistentCreateReplay(tx, command);
    if (replay) {
      const snapshot = parseSimulationLossItemSnapshot(replay.resultSnapshot);
      if (snapshot) return { lossItem: snapshot, versions: simulationVersionsFromResult(result) };
      const storedItem = await tx.simulationLossItem.findFirst({
        where: { id: replay.resultId, simulationSubjectResultId: result.id },
        include: { syllabusNode: true },
      });
      if (!storedItem) throw new ApiError("SIMULATION_LOSS_ITEM_IDEMPOTENCY_RESULT_UNAVAILABLE", 409);
      return { lossItem: serializeLossItem(storedItem), versions: simulationVersionsFromResult(result) };
    }

    await assertLossParentRevisions(result, input, tx, workspace.id);
    await assertSubjectExists(result.subjectId, workspace.id, tx);
    assertSimulationDraft(result.simulationExam.status);
    await assertLossNodeForSubject(input.syllabusNodeId, result.subjectId, workspace.id, tx);
    const created = await tx.simulationLossItem.create({
      data: {
        simulationSubjectResultId: result.id,
        reason: input.reason,
        syllabusNodeId: input.syllabusNodeId ?? null,
        lostScore: input.lostScore,
        note: normalizeOptionalText(input.note ?? undefined),
      },
      include: { syllabusNode: true },
    });
    const versions = await bumpSimulationVersions(tx, result.id, result.simulationExamId, result.simulationExam.status);
    const response = serializeLossItem(created);
    await recordPersistentCreateResult(tx, command, created.id, {
      simulationSubjectResultId: result.id,
      resultSnapshot: response as unknown as Prisma.InputJsonObject,
    });
    return { lossItem: response, versions };
  });
}

function parseSimulationExamSnapshot(value: Prisma.JsonValue | undefined): SimulationExamDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return typeof value.id === "string" && Array.isArray(value.subjectResults)
    ? value as unknown as SimulationExamDto
    : null;
}

function parseSimulationLossItemSnapshot(value: Prisma.JsonValue | undefined): SimulationLossItemDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return typeof value.id === "string" && typeof value.reason === "string"
    ? value as unknown as SimulationLossItemDto
    : null;
}

export async function updateSimulationLossItem(
  subjectResultId: string,
  lossItemId: string,
  input: Partial<SaveSimulationLossItemInput> & { expectedRevision: number },
  actorId: string,
) {
  return (await updateSimulationLossItemCommand(subjectResultId, lossItemId, input, actorId)).lossItem;
}

export async function updateSimulationLossItemCommand(
  subjectResultId: string,
  lossItemId: string,
  input: Partial<SaveSimulationLossItemInput> & { expectedRevision: number },
  actorId: string,
): Promise<SimulationLossItemMutationResult> {
  return mutateSimulationLossItem(subjectResultId, lossItemId, input, actorId, async (tx, context) => {
    await assertLossNodeForSubject(input.syllabusNodeId, context.subjectId, context.workspaceId, tx);
    const changed = await tx.simulationLossItem.updateMany({
      where: { id: lossItemId, simulationSubjectResultId: subjectResultId, revision: input.expectedRevision },
      data: {
        reason: input.reason,
        syllabusNodeId: input.syllabusNodeId,
        lostScore: input.lostScore,
        note: input.note === undefined ? undefined : normalizeOptionalText(input.note ?? undefined),
        revision: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw await lossItemConflict(tx, lossItemId);
    return "SIMULATION_LOSS_ITEM_UPDATED";
  });
}

export async function archiveSimulationLossItem(subjectResultId: string, lossItemId: string, expectedRevision: number, actorId: string) {
  return (await archiveSimulationLossItemCommand(subjectResultId, lossItemId, { expectedRevision }, actorId)).lossItem;
}

export async function archiveSimulationLossItemCommand(
  subjectResultId: string,
  lossItemId: string,
  input: { expectedRevision: number; expectedExamRevision?: number; expectedSubjectResultRevision?: number },
  actorId: string,
): Promise<SimulationLossItemMutationResult> {
  return mutateSimulationLossItem(subjectResultId, lossItemId, input, actorId, async (tx) => {
    const changed = await tx.simulationLossItem.updateMany({
      where: { id: lossItemId, simulationSubjectResultId: subjectResultId, revision: input.expectedRevision, archivedAt: null },
      data: { archivedAt: new Date(), revision: { increment: 1 } },
    });
    if (changed.count !== 1) throw await lossItemConflict(tx, lossItemId);
    return "SIMULATION_LOSS_ITEM_ARCHIVED";
  });
}

export async function restoreSimulationLossItem(subjectResultId: string, lossItemId: string, expectedRevision: number, actorId: string) {
  return (await restoreSimulationLossItemCommand(subjectResultId, lossItemId, { expectedRevision }, actorId)).lossItem;
}

export async function restoreSimulationLossItemCommand(
  subjectResultId: string,
  lossItemId: string,
  input: { expectedRevision: number; expectedExamRevision?: number; expectedSubjectResultRevision?: number },
  actorId: string,
): Promise<SimulationLossItemMutationResult> {
  return mutateSimulationLossItem(subjectResultId, lossItemId, input, actorId, async (tx) => {
    const changed = await tx.simulationLossItem.updateMany({
      where: { id: lossItemId, simulationSubjectResultId: subjectResultId, revision: input.expectedRevision, archivedAt: { not: null } },
      data: { archivedAt: null, revision: { increment: 1 } },
    });
    if (changed.count !== 1) throw await lossItemConflict(tx, lossItemId);
    return "SIMULATION_LOSS_ITEM_RESTORED";
  });
}

async function mutateSimulationLossItem(
  subjectResultId: string,
  lossItemId: string,
  input: { expectedRevision: number; expectedExamRevision?: number; expectedSubjectResultRevision?: number },
  actorId: string,
  mutation: (tx: Prisma.TransactionClient, context: { subjectId: string; workspaceId: string }) => Promise<string>,
): Promise<SimulationLossItemMutationResult> {
  const result = await prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const result = await loadOwnedSubjectResult(subjectResultId, workspace.id, tx);
    await assertLossParentRevisions(result, input, tx, workspace.id);
    await assertSubjectExists(result.subjectId, workspace.id, tx);
    assertSimulationDraft(result.simulationExam.status);
    const existing = result.lossItems.find((candidate) => candidate.id === lossItemId);
    if (!existing) throw new ApiError("SIMULATION_LOSS_ITEM_NOT_FOUND", 404);
    if (existing.revision !== input.expectedRevision) throw await lossItemConflict(tx, lossItemId);
    const action = await mutation(tx, { subjectId: result.subjectId, workspaceId: workspace.id });
    const versions = await bumpSimulationVersions(tx, result.id, result.simulationExamId, result.simulationExam.status);
    await audit(actorId, action, "SimulationLossItem", lossItemId, tx);
    const item = await tx.simulationLossItem.findUniqueOrThrow({ where: { id: lossItemId }, include: { syllabusNode: true } });
    return { item, versions };
  });
  return { lossItem: serializeLossItem(result.item), versions: result.versions };
}

async function loadOwnedSubjectResult(subjectResultId: string, workspaceId: string, client: SimulationDbClient = prisma) {
  const result = await client.simulationSubjectResult.findFirst({
    where: { id: subjectResultId, simulationExam: { workspaceId } },
    include: { simulationExam: { select: { id: true, status: true, revision: true } }, lossItems: { include: { syllabusNode: true } } },
  });
  if (!result) throw new ApiError("SIMULATION_SUBJECT_RESULT_NOT_FOUND", 404);
  return result;
}

async function loadSimulationExamDto(
  client: SimulationDbClient,
  examId: string,
  workspaceId: string,
): Promise<SimulationExamDto | undefined> {
  const exam = await client.simulationExam.findFirst({
    where: { id: examId, workspaceId },
    include: simulationExamInclude,
  });
  return exam ? serializeSimulationExam(exam) : undefined;
}

function assertSimulationDraft(status: string) {
  if (status !== "DRAFT" && status !== "IN_PROGRESS") throw new ApiError("SIMULATION_EXAM_CONFIRMED", 409);
}

async function assertLossParentRevisions(
  result: {
    revision: number;
    simulationExamId: string;
    simulationExam: { revision: number; status: string };
  },
  input: { expectedExamRevision?: number; expectedSubjectResultRevision?: number },
  client: SimulationDbClient,
  workspaceId: string,
): Promise<void> {
  const conflictFields = [
    ...(input.expectedExamRevision !== undefined && input.expectedExamRevision !== result.simulationExam.revision
      ? ["revision"]
      : []),
    ...(input.expectedSubjectResultRevision !== undefined && input.expectedSubjectResultRevision !== result.revision
      ? ["subjectResults.revision"]
      : []),
  ];
  if (conflictFields.length === 0) return;
  throw new ApiError(
    conflictFields.includes("revision") ? "SIMULATION_EXAM_REVISION_CONFLICT" : "SIMULATION_SUBJECT_REVISION_CONFLICT",
    409,
    {
      latest: await loadSimulationExamDto(client, result.simulationExamId, workspaceId),
      conflictFields,
      workbench: "/test/simulations",
    },
  );
}

async function assertLossNodeForSubject(
  syllabusNodeId: string | null | undefined,
  subjectId: string,
  workspaceId: string,
  client: SimulationDbClient,
) {
  if (syllabusNodeId === undefined || syllabusNodeId === null) return;
  const node = await client.syllabusNode.findFirst({ where: { id: syllabusNodeId, subjectId, subject: { workspaceId } }, select: { id: true } });
  if (!node) throw new ApiError("SIMULATION_LOSS_NODE_NOT_FOUND", 404);
}

async function bumpSimulationVersions(
  tx: Prisma.TransactionClient,
  subjectResultId: string,
  examId: string,
  examStatus: string,
): Promise<SimulationLossItemMutationResult["versions"]> {
  const [subjectResult, exam] = await Promise.all([
    tx.simulationSubjectResult.update({ where: { id: subjectResultId }, data: { revision: { increment: 1 } }, select: { revision: true } }),
    tx.simulationExam.update({ where: { id: examId }, data: { revision: { increment: 1 } }, select: { revision: true } }),
  ]);
  return {
    subjectResultRevision: subjectResult.revision,
    examRevision: exam.revision,
    examStatus: examStatus as SimulationExamDto["status"],
  };
}

function simulationVersionsFromResult(result: {
  revision: number;
  simulationExam: { revision: number; status: string };
}): SimulationLossItemMutationResult["versions"] {
  return {
    subjectResultRevision: result.revision,
    examRevision: result.simulationExam.revision,
    examStatus: result.simulationExam.status as SimulationExamDto["status"],
  };
}

async function lossItemConflict(tx: Prisma.TransactionClient, lossItemId: string): Promise<ApiError> {
  const latest = await tx.simulationLossItem.findUnique({ where: { id: lossItemId }, include: { syllabusNode: true } });
  return new ApiError("SIMULATION_LOSS_ITEM_REVISION_CONFLICT", 409, {
    latest: latest ? serializeLossItem(latest) : undefined,
    conflictFields: ["revision"],
  });
}

export interface SimulationRemediationSelection {
  originKey: string;
  originVersion: number;
}

export async function listSimulationRemediations(examId: string, actorId: string): Promise<SimulationRemediationDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  return loadSimulationRemediations(examId, workspace.id, prisma, false, true);
}

async function loadSimulationRemediations(
  examId: string,
  workspaceId: string,
  client: SimulationDbClient,
  allowLegacy: boolean,
  activeSubjectsOnly = false,
): Promise<SimulationRemediationDto[]> {
  const exam = await client.simulationExam.findFirst({
    where: { id: examId, ...(allowLegacy ? { OR: [{ workspaceId }, { workspaceId: null }] } : { workspaceId }) },
    select: {
      revision: true,
      workspaceId: true,
      subjectResults: {
        select: {
          subjectId: true,
          id: true,
          revision: true,
          subject: { select: { name: true, archivedAt: true } },
          lossItems: {
            where: { archivedAt: null },
            select: {
              id: true,
              reason: true,
              syllabusNodeId: true,
              lostScore: true,
              syllabusNode: { select: { title: true } },
            },
          },
        },
      },
    },
  });
  if (!exam) throw new ApiError("SIMULATION_EXAM_NOT_FOUND", 404);
  if (exam.workspaceId == null) return [];
  const subjectResults = activeSubjectsOnly
    ? exam.subjectResults.filter((result) => result.subject.archivedAt == null)
    : exam.subjectResults;
  const itemLookup = new Map(subjectResults.flatMap((result) => result.lossItems.map((item) => [item.id, { item, result }] as const)));
  const remediations = buildSimulationRemediationGroups(subjectResults.flatMap((result) => result.lossItems.map((item) => ({
    id: item.id,
    subjectId: result.subjectId,
    reason: item.reason as SimulationLossReason,
    syllabusNodeId: item.syllabusNodeId,
    lostScore: item.lostScore,
  }))), { examId }).map((group) => {
    const sample = group.itemIds.length > 0 ? itemLookup.get(group.itemIds[0]!) : undefined;
    if (!sample) throw new ApiError("SIMULATION_REMEDIATION_SOURCE_INVALID", 409);
    return {
      ...group,
      subjectResultId: sample.result.id,
      subjectName: sample.result.subject.name,
      syllabusNodeTitle: sample.item.syllabusNode?.title ?? null,
      originVersion: sample.result.revision,
    };
  });
  if (remediations.length === 0) return [];
  const inboxItems = await client.planInboxItem.findMany({
    where: {
      workspaceId,
      originKey: { in: remediations.map((item) => item.originKey) },
    },
    select: { id: true, originKey: true, originVersion: true, status: true },
  });
  const inboxByOrigin = new Map(inboxItems.map((item) => [`${item.originKey}:${item.originVersion}`, item]));
  return remediations.map((remediation) => {
    const inboxItem = inboxByOrigin.get(`${remediation.originKey}:${remediation.originVersion}`);
    return {
      ...remediation,
      inboxItemId: inboxItem?.id ?? null,
      inboxStatus: inboxItem?.status ?? null,
    };
  });
}

export async function addSimulationRemediationsToInbox(
  examId: string,
  actorId: string,
  selections: SimulationRemediationSelection[],
): Promise<{ created: number; reused: number }> {
  if (new Set(selections.map((selection) => selection.originKey)).size !== selections.length) {
    throw new ApiError("SIMULATION_REMEDIATION_DUPLICATE", 400);
  }

  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const candidates = await loadSimulationRemediations(examId, workspace.id, tx, false);
    const candidateByKey = new Map(candidates.map((candidate) => [candidate.originKey, candidate]));
    const selected = selections.map((selection) => {
      const candidate = candidateByKey.get(selection.originKey);
      if (!candidate || candidate.originVersion !== selection.originVersion) {
        throw new ApiError("SIMULATION_REMEDIATION_STALE", 409, {
          latest: candidate ?? undefined,
          conflictFields: ["originKey", "originVersion"],
        });
      }
      return candidate;
    });
    await assertSubjectsExist(selected.map((candidate) => candidate.subjectId), workspace.id, tx);
    let created = 0;
    let reused = 0;
    for (const candidate of selected) {
      const write = await createPlanInboxItemWithResult(tx, workspace.id, actorId, {
        stableKey: `${candidate.originKey}:v${candidate.originVersion}`,
        originKey: candidate.originKey,
        originVersion: candidate.originVersion,
        originType: "SIMULATION_LOSS",
        originSnapshot: buildSimulationRemediationOriginSnapshot({
          examId,
          subjectResultId: candidate.subjectResultId,
          subjectResultRevision: candidate.originVersion,
          subjectId: candidate.subjectId,
          itemIds: candidate.itemIds,
          lostScore: candidate.lostScore,
          reason: candidate.reason,
          syllabusNodeId: candidate.syllabusNodeId,
        }),
        title: `${candidate.subjectName}：补救 ${labelSimulationLossReason(candidate.reason)}（${candidate.lostScore} 分）`,
        subjectId: candidate.subjectId,
        primaryNodeId: candidate.syllabusNodeId,
        estimatedMinutes: candidate.lostScore >= 10 ? 60 : 30,
        priority: candidate.lostScore >= 10 ? "critical" : "high",
        type: "review",
      });
      created += write.created ? 1 : 0;
      reused += write.reused ? 1 : 0;
    }
    return { created, reused };
  });
}

function labelSimulationLossReason(reason: SimulationLossReason): string {
  return ({
    CONCEPT_GAP: "概念缺口", MEMORY_FORMULA: "记忆/公式", METHOD_ERROR: "方法错误",
    CALCULATION_CARELESS: "计算/粗心", TIME_ALLOCATION: "时间分配", READING_COMPREHENSION: "审题理解",
    UNFAMILIAR_PATTERN: "题型陌生", MINDSET: "心态", UNANSWERED: "未作答", OTHER: "其他",
  } satisfies Record<SimulationLossReason, string>)[reason];
}

export async function listSimulationTasks(actorId: string): Promise<StudyTaskDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const tasks = await prisma.studyTask.findMany({
    where: {
      type: "simulation_exam",
      subject: { workspaceId: workspace.id },
    },
    include: {
      subject: true,
      syllabusNode: true,
      stageLinks: { include: { stagePlan: { select: { name: true } } } },
      knowledgePointLinks: { include: { knowledgePoint: { select: { title: true } } } },
    },
    orderBy: [{ plannedDate: "asc" }, { createdAt: "desc" }],
    take: 100,
  });

  return tasks.map(serializeTask);
}

export async function createSimulationTask(
  input: CreateSimulationTaskInput,
  actorId: string,
): Promise<StudyTaskDto> {
  const task = await prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    await assertSubjectExists(input.subjectId, workspace.id, tx);
    if (input.syllabusNodeId) {
      await assertSyllabusNodeBelongsToSubject(input.syllabusNodeId, input.subjectId, tx, workspace.id);
    }
    const createdTask = await tx.studyTask.create({
      data: {
        subjectId: input.subjectId,
        syllabusNodeId: input.syllabusNodeId ?? null,
        title: input.title,
        type: "simulation_exam",
        priority: "CRITICAL",
        plannedDate: new Date(input.plannedDate),
        estimatedMinutes: input.estimatedMinutes,
      },
      include: {
        subject: true,
        syllabusNode: true,
        stageLinks: { include: { stagePlan: { select: { name: true } } } },
        knowledgePointLinks: { include: { knowledgePoint: { select: { title: true } } } },
      },
    });

    await audit(actorId, "SIMULATION_TASK_CREATED", "StudyTask", createdTask.id, tx);
    await refreshCheckInSnapshotsForDates([createdTask.plannedDate], tx);

    return createdTask;
  });

  return serializeTask(task);
}

export async function completeSimulationTask(
  id: string,
  input: CompleteSimulationTaskInput,
  actorId: string,
): Promise<StudyTaskDto> {
  const task = await prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const existing = await tx.studyTask.findFirst({
      where: { id, subject: { workspaceId: workspace.id } },
      select: {
        id: true,
        type: true,
        status: true,
        debtStatus: true,
        estimatedMinutes: true,
        plannedDate: true,
        completedAt: true,
        updatedAt: true,
        subject: { select: { archivedAt: true } },
      },
    });
    if (!existing || existing.type !== "simulation_exam") {
      throw new ApiError("SIMULATION_TASK_NOT_FOUND", 404);
    }
    if (existing.subject.archivedAt) {
      throw new ApiError("SUBJECT_ARCHIVED", 409);
    }
    if (!["TODO", "IN_PROGRESS", "DEFERRED"].includes(existing.status)) {
      throw new ApiError("TASK_STATE_CONFLICT", 409);
    }

    const completedAt = new Date();
    const isFirstSynchronizedSimulation = false;
    await applyTaskCas(tx, existing, {
      status: "DONE",
      debtStatus: "NONE",
      actualMinutes: input.durationMinutes,
      reviewText: composeSimulationReview(
        input,
        maybeSummarizeSimulationResult(input, existing.estimatedMinutes, isFirstSynchronizedSimulation),
      ),
      completedAt,
    });
    const updatedTask = await tx.studyTask.findUnique({
      where: { id },
      include: {
        subject: true,
        syllabusNode: true,
        stageLinks: { include: { stagePlan: { select: { name: true } } } },
        knowledgePointLinks: { include: { knowledgePoint: { select: { title: true } } } },
      },
    });
    if (!updatedTask) throw new ApiError("TASK_STATE_CONFLICT", 409);

    await audit(actorId, "SIMULATION_TASK_COMPLETED", "StudyTask", updatedTask.id, tx);
    await createTaskDebtEvent({
      taskId: updatedTask.id,
      actorId,
      action: "complete",
      from: toTaskDebtEventState(existing),
      to: toTaskDebtEventState(updatedTask),
      reason: "完成模拟考试任务",
      metadata: {
        source: "simulation_task_complete_api",
        targetScore: input.targetScore ?? null,
        actualScore: input.actualScore ?? null,
        durationMinutes: input.durationMinutes ?? null,
        blankCount: input.blankCount ?? null,
        hasLossReason: Boolean(input.lossReason?.trim()),
        hasMindset: Boolean(input.mindset?.trim()),
        summaryProvided: Boolean(input.summary.trim()),
        isFirstSynchronizedSimulation,
        previousCompletedAt: existing.completedAt?.toISOString() ?? null,
        completedAt: completedAt.toISOString(),
      },
    }, tx);
    await refreshCheckInSnapshotsForDates([updatedTask.plannedDate], tx);

    return updatedTask;
  });

  return serializeTask(task);
}

export async function getSimulationStageDraft(actorId: string, now = new Date()): Promise<SimulationStageDraftDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const [analytics, motivationVault, nextSimulation] = await Promise.all([
    getAnalyticsSummary(now, actorId),
    getMotivationVaultShared(),
    prisma.simulationExam.findFirst({
      where: {
        workspaceId: workspace.id,
        status: { not: "CONFIRMED" },
        examDate: { gte: getStudyDayRange(now).start },
      },
      orderBy: [{ examDate: "asc" }, { createdAt: "asc" }],
      select: { name: true, examDate: true },
    }),
  ]);
  const daysToSimulation = optionalDaysUntil(nextSimulation?.examDate, now);
  const readiness = evaluateSimulationReadiness({
    daysToSimulation,
    weeklyEffectiveMinutes: analytics.totals.weekEffectiveMinutes,
    weeklyTaskCompletionRate: analytics.totals.weeklyTaskCompletionRate,
    reviewCompletionRate: analytics.totals.reviewCompletionRate,
    weakNodeCount: analytics.totals.weakNodeCount,
    dueMistakeCount: analytics.totals.dueMistakes,
    hasFirstSimulationDiary: Boolean(motivationVault?.firstSimulationDiary),
  });
  const stageAdjustment = draftStageAdjustment({
    stageGoal: workspace.stageSummary?.trim() || "当前考试目标",
    taskCompletionRate: analytics.totals.weeklyTaskCompletionRate,
    subjectInvestmentBalance: calculateSubjectInvestmentBalance(analytics.subjects),
    mistakeReviewRate: calculateMistakeReviewRate(analytics.totals.totalMistakes, analytics.totals.dueMistakes),
    reviewCompletionRate: analytics.totals.reviewCompletionRate,
    currentStreakDays: analytics.totals.streakDays,
    breakCount: analytics.totals.missedDays,
    lowConversionCount: analytics.totals.lowConversionCount,
    weakSubjectNames: chooseFocusSubjects(analytics.subjects),
    simulationScoreRate: null,
    daysToFinal: optionalDaysUntil(workspace.targetExamDate, now),
  });

  return {
    simulationNode: nextSimulation ? {
      title: nextSimulation.name,
      date: nextSimulation.examDate.toISOString(),
      daysToSimulation: optionalDaysUntil(nextSimulation.examDate, now) ?? 0,
      isPhaseNode: true,
    } : null,
    readiness,
    draft: {
      status: "local_rule_fallback",
      riskConclusion: stageAdjustment.riskConclusion,
      focusSubjects: stageAdjustment.focusSubjects,
      intensityAdjustment: stageAdjustment.nextStageEmphasis,
      modeRecommendation: mapStageAdjustmentMode(stageAdjustment.mode, readiness),
      taskActions: [
        ...readiness.nextActions,
        ...stageAdjustment.taskAdjustmentActions.map(labelStageTaskAction),
      ].slice(0, 6),
      risk: stageAdjustment.risk,
      taskIntensity: stageAdjustment.taskIntensity,
      requiresUserConfirmation: stageAdjustment.requiresUserConfirmation,
      canAutoApply: stageAdjustment.canAutoApply,
      privacyBoundary: "本草稿由本地规则生成，不调用外部 AI，不发送动机档案、完整情绪记录或复盘正文。",
    },
  };
}

export async function saveFirstSimulationDiary(
  firstSimulationDiary: string,
  actorId: string,
  idempotencyKey: string,
): Promise<MotivationVaultDto> {
  const existing = await getMotivationVault();

  return saveMotivationVault(
    {
      idempotencyKey,
      expectedUpdatedAt: existing?.updatedAt ?? null,
      whyStarted: existing?.whyStarted ?? undefined,
      neverReturnTo: existing?.neverReturnTo ?? undefined,
      futureSelf: existing?.futureSelf ?? undefined,
      messageToFuture: existing?.messageToFuture ?? undefined,
      firstSimulationDiary,
    },
    actorId,
  );
}

function composeSimulationReview(
  input: CompleteSimulationTaskInput,
  resultSummary: SimulationResultSummary | null,
): string {
  const lines = [
    ["目标分", input.targetScore],
    ["实际分", input.actualScore],
    ["用时", input.durationMinutes ? `${input.durationMinutes} 分钟` : undefined],
    ["空题数量", input.blankCount === undefined ? undefined : `${input.blankCount}`],
    ["失分原因", input.lossReason],
    ["心态记录", input.mindset],
    ["规则复盘", resultSummary ? formatSimulationResultSummary(resultSummary) : undefined],
    ["考后总结", input.summary],
  ];

  return lines
    .filter(([, value]) => value !== undefined && `${value}`.trim().length > 0)
    .map(([label, value]) => `${label}：${value}`)
    .join("\n");
}

function maybeSummarizeSimulationResult(
  input: CompleteSimulationTaskInput,
  targetDurationMinutes: number,
  isFirstSynchronizedSimulation: boolean,
): SimulationResultSummary | null {
  const targetScore = parseScore(input.targetScore);
  const actualScore = parseScore(input.actualScore);
  if (targetScore == null || actualScore == null) return null;

  return summarizeSimulationResult({
    targetScore,
    actualScore,
    targetDurationMinutes,
    actualDurationMinutes: input.durationMinutes ?? targetDurationMinutes,
    blankQuestionCount: input.blankCount ?? 0,
    lossReasons: splitLossReasons(input.lossReason),
    mood: input.mindset,
    isFirstSynchronizedSimulation,
  });
}

function parseScore(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

function splitLossReasons(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\n,，;；、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatSimulationResultSummary(summary: SimulationResultSummary): string {
  return [
    `表现：${labelSimulationPerformance(summary.performance)}，分差 ${summary.scoreGap >= 0 ? "+" : ""}${summary.scoreGap}，达成率 ${Math.round(summary.scoreRate * 100)}%。`,
    `时间压力：${labelTimePressure(summary.timePressure)}。`,
    `主要短板：${summary.mainShortfalls.join("、")}。`,
    `下一步：${summary.nextActions.join(" / ")}`,
    summary.shouldRecalibratePlan ? "需要重校准阶段计划：是。" : "需要重校准阶段计划：否。",
    `考后必填：${summary.postSimulationRequiredFields.join("、")}。`,
  ].join("\n");
}

function labelSimulationPerformance(performance: SimulationResultSummary["performance"]): string {
  switch (performance) {
    case "above_target":
      return "超过目标";
    case "near_target":
      return "接近目标";
    case "below_target":
      return "低于目标";
    case "collapse":
      return "明显崩盘";
  }
}

function labelTimePressure(pressure: SimulationResultSummary["timePressure"]): string {
  switch (pressure) {
    case "low":
      return "低";
    case "medium":
      return "中";
    case "high":
      return "高";
  }
}

async function assertSubjectExists(
  subjectId: string,
  workspaceId: string,
  client: SimulationDbClient,
): Promise<void> {
  const subject = await client.subject.findFirst({
    where: { id: subjectId, workspaceId },
    select: { archivedAt: true },
  });

  if (!subject) {
    throw new ApiError("SUBJECT_NOT_FOUND", 404);
  }
  if (subject.archivedAt) {
    throw new ApiError("SUBJECT_ARCHIVED", 409);
  }
}

async function assertSubjectsExist(
  subjectIds: string[],
  workspaceId: string,
  client: SimulationDbClient,
  conflictDetails?: { latest?: unknown; conflictFields?: string[] },
): Promise<void> {
  const uniqueSubjectIds = Array.from(new Set(subjectIds));
  const subjects = await client.subject.findMany({
    where: {
      id: { in: uniqueSubjectIds },
      workspaceId,
    },
    select: { id: true, archivedAt: true },
  });

  if (subjects.length !== uniqueSubjectIds.length) {
    throw new ApiError("SUBJECT_NOT_FOUND", 404);
  }
  if (subjects.some((subject) => subject.archivedAt)) {
    throw new ApiError("SUBJECT_ARCHIVED", 409, conflictDetails);
  }
}

function assertUniqueSubjectResults(results: SimulationSubjectResultInput[]): void {
  const seen = new Set<string>();
  for (const result of results) {
    if (seen.has(result.subjectId)) {
      throw new ApiError("SIMULATION_SUBJECT_DUPLICATE", 400);
    }
    seen.add(result.subjectId);
  }
}

function chooseFocusSubjects(
  subjects: Array<{
    subjectName: string;
    effectiveMinutes: number;
    share: number;
  }>,
): string[] {
  const focus = [...subjects]
    .sort((left, right) => {
      if (left.effectiveMinutes === right.effectiveMinutes) {
        return left.share - right.share;
      }
      return left.effectiveMinutes - right.effectiveMinutes;
    })
    .slice(0, 3)
    .map((subject) => subject.subjectName);

  return focus;
}

function calculateSubjectInvestmentBalance(subjects: Array<{ share: number }>): number | null {
  if (subjects.length === 0 || subjects.every((subject) => subject.share === 0)) return null;
  const maxShare = Math.max(0, ...subjects.map((subject) => subject.share));
  return Math.max(0, Math.min(1, 1 - maxShare / 100));
}

function calculateMistakeReviewRate(totalMistakes: number, dueMistakes: number): number | null {
  if (totalMistakes <= 0) return null;
  return Math.max(0, Math.min(1, 1 - dueMistakes / totalMistakes));
}

function mapStageAdjustmentMode(
  mode: StageAdjustmentDraft["mode"],
  readiness: SimulationReadinessSummary,
): SimulationStageDraftDto["draft"]["modeRecommendation"] {
  if (readiness.level === "simulation_window") return "simulation_window";
  switch (mode) {
    case "recovery":
      return "recovery";
    case "strengthen":
      return "strengthening";
    case "sprint":
      return "simulation_window";
    case "maintain":
      return "steady";
  }
}

function labelStageTaskAction(action: StageAdjustmentDraft["taskAdjustmentActions"][number]): string {
  switch (action) {
    case "split":
      return "把过大的任务拆小，只保留能完成的最小动作。";
    case "defer":
      return "延期低优先级任务，避免挤占有效学习。";
    case "drop":
      return "放弃当前阶段低价值任务，先保关键目标。";
    case "convert_review":
      return "把低转化任务改成复习或错题任务。";
    case "simulate":
      return "安排一次完整模拟，并当天完成复盘。";
    case "retest":
      return "对薄弱节点安排复测，补掌握证明。";
  }
}

function serializeSimulationExam(exam: {
  id: string;
  name: string;
  examDate: Date;
  isFirstSynchronized: boolean;
  targetDurationMinutes: number | null;
  actualDurationMinutes: number | null;
  targetScore: number | null;
  actualScore: number | null;
  blankQuestionCount: number;
  lossReasons: unknown;
  mindset: string | null;
  summary: string | null;
  reviewText: string | null;
  status: string;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  revision: number;
  studySessions: Array<{ id: string; status: string }>;
  subjectResults: Array<{
    id: string;
    simulationExamId: string;
    subjectId: string;
    paperFullScore: number | null;
    targetScore: number | null;
    actualScore: number | null;
    durationMinutes: number | null;
    blankQuestionCount: number;
    lossReasons: unknown;
    summary: string | null;
    revision: number;
    lossItems: Array<{
      id: string;
      reason: string;
      syllabusNodeId: string | null;
      lostScore: number;
      note: string | null;
      mistakeId: string | null;
      revision: number;
      archivedAt: Date | null;
      syllabusNode: { title: string } | null;
    }>;
    subject: {
      name: string;
      color: string;
    };
  }>;
}): SimulationExamDto {
  const timerSession = exam.studySessions[0] ?? null;
  const hasLegacyTotals = exam.targetScore != null || exam.actualScore != null || exam.lossReasons != null;
  const totalsSource = exam.subjectResults.length > 0 || !hasLegacyTotals ? "subject_sum" : "legacy_fallback";
  const subjectTargetScore = sumComplete(exam.subjectResults, "targetScore");
  const subjectActualScore = sumComplete(exam.subjectResults, "actualScore");
  const warnings = exam.subjectResults.flatMap((result) => {
    if (result.paperFullScore == null || result.actualScore == null) return [];
    const structuredLoss = result.lossItems
      .filter((item) => item.archivedAt == null)
      .reduce((sum, item) => sum + item.lostScore, 0);
    const realLoss = Math.max(0, result.paperFullScore - result.actualScore);
    return Math.abs(structuredLoss - realLoss) >= 0.25
      ? [`${result.subject.name}：结构化失分 ${structuredLoss} 分与真实丢分 ${realLoss} 分不一致`]
      : [];
  });
  return {
    id: exam.id,
    name: exam.name,
    examDate: exam.examDate.toISOString(),
    isFirstSynchronized: exam.isFirstSynchronized,
    targetDurationMinutes: exam.targetDurationMinutes,
    actualDurationMinutes: exam.actualDurationMinutes,
    targetScore: totalsSource === "subject_sum" ? subjectTargetScore : exam.targetScore,
    actualScore: totalsSource === "subject_sum" ? subjectActualScore : exam.actualScore,
    blankQuestionCount: exam.blankQuestionCount,
    lossReasons: parseLossReasons(exam.lossReasons),
    mindset: exam.mindset,
    summary: exam.summary,
    reviewText: exam.reviewText,
    status: exam.status as SimulationExamDto["status"],
    timerSessionId: activeTimerSessionId(exam.studySessions),
    timerSessionStatus: timerSession ? timerSession.status as SimulationExamDto["timerSessionStatus"] : null,
    confirmedAt: exam.confirmedAt?.toISOString() ?? null,
    createdAt: exam.createdAt.toISOString(),
    updatedAt: exam.updatedAt.toISOString(),
    revision: exam.revision,
    totalsSource,
    legacyDisplayTotals: totalsSource === "legacy_fallback" ? { targetScore: exam.targetScore, actualScore: exam.actualScore } : null,
    warnings,
    subjectResults: exam.subjectResults.map((result) => ({
      id: result.id,
      simulationExamId: result.simulationExamId,
      subjectId: result.subjectId,
      subjectName: result.subject.name,
      subjectColor: result.subject.color,
      paperFullScore: result.paperFullScore,
      targetScore: result.targetScore,
      actualScore: result.actualScore,
      durationMinutes: result.durationMinutes,
      blankQuestionCount: result.blankQuestionCount,
      lossReasons: parseLossReasons(result.lossReasons),
      summary: result.summary,
      revision: result.revision,
      lossItems: result.lossItems.map(serializeLossItem),
    })),
  };
}

function serializeLossItem(item: {
  id: string;
  reason: string;
  syllabusNodeId: string | null;
  lostScore: number;
  note: string | null;
  mistakeId: string | null;
  revision: number;
  archivedAt: Date | null;
  syllabusNode: { title: string } | null;
}): SimulationLossItemDto {
  return {
    id: item.id,
    reason: item.reason as SimulationLossItemDto["reason"],
    syllabusNodeId: item.syllabusNodeId,
    syllabusNodeTitle: item.syllabusNode?.title ?? null,
    lostScore: item.lostScore,
    note: item.note,
    mistakeId: item.mistakeId,
    revision: item.revision,
    archivedAt: item.archivedAt?.toISOString() ?? null,
  };
}

async function assertSimulationLossNodes(
  results: SimulationSubjectResultInput[],
  client: SimulationDbClient,
): Promise<void> {
  for (const result of results) {
    const nodeIds = Array.from(new Set((result.lossItems ?? []).map((item) => item.syllabusNodeId).filter((id): id is string => Boolean(id))));
    if (nodeIds.length === 0) continue;
    const count = await client.syllabusNode.count({
      where: { id: { in: nodeIds }, subjectId: result.subjectId, archivedAt: null },
    });
    if (count !== nodeIds.length) throw new ApiError("SIMULATION_LOSS_NODE_SUBJECT_MISMATCH", 400);
  }
}

function sumComplete<K extends PropertyKey>(
  items: Array<Partial<Record<K, number | null | undefined>>>,
  key: K,
): number | null {
  const values = items.map((item) => item[key]);
  const numericValues = values.filter((value): value is number => typeof value === "number");
  if (values.length === 0 || numericValues.length !== values.length) return null;
  return numericValues.reduce((total, value) => total + value, 0);
}

function normalizeLossReasons(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, 20);
}

function parseLossReasons(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeOptionalText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
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
  client: SimulationDbClient = prisma,
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
