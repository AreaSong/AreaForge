import {
  draftStageAdjustment,
  type StageAdjustmentDraft,
} from "@areaforge/core";
import { prisma, type Prisma, type PrismaClient } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type {
  StageAdjustmentConflictLatest,
  StageAdjustmentDecisionReplay,
  StageAdjustmentDecisionResult,
  StagePlanConflictLatest,
} from "@/lib/contracts/simulation";
import { getAnalyticsSummary } from "./analytics-service";
import { getStudyDayRange, optionalDaysUntil } from "./date";
import { createPlanInboxItemWithResult, type PlanInboxWriteResult } from "./plan-inbox-service";
import type {
  PlanInboxWriteSummaryDto,
  StageAdjustmentDraftRecordDto,
  StageAdjustmentTaskActionDto,
  StagePlanDto,
} from "@/lib/contracts";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import {
  buildPersistentCreateFingerprint,
  findPersistentCreateReplay,
  normalizeIdempotencyKey,
  recordPersistentCreateResult,
} from "./persistent-idempotency";

export type {
  StageAdjustmentConflictLatest,
  StageAdjustmentDecisionReplay,
  StageAdjustmentDecisionResult,
  StagePlanConflictLatest,
} from "@/lib/contracts/simulation";

const stageWorkbench = "/roadmap/stages";

type StageDbClient = PrismaClient | Prisma.TransactionClient;

export interface SaveStagePlanInput {
  idempotencyKey: string;
  baseRevision: number | null;
  name: string;
  startDate: string;
  endDate: string;
  goal: string;
  mode?: StageAdjustmentDraft["mode"];
  status?: StagePlanDto["status"];
}

export interface CreateStageAdjustmentDraftInput {
  idempotencyKey: string;
  stagePlanId?: string | null;
}

export async function listStagePlans(actorId: string): Promise<StagePlanDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const plans = await prisma.stagePlan.findMany({
    where: { workspaceId: workspace.id },
    orderBy: [{ status: "asc" }, { startDate: "asc" }, { createdAt: "desc" }],
    take: 50,
  });

  return plans.map(serializeStagePlan);
}

export async function getCurrentStagePlan(actorId: string): Promise<StagePlanDto | null> {
  const workspace = await resolveActiveWorkspace(actorId);
  const plan = await prisma.stagePlan.findFirst({
    where: { workspaceId: workspace.id, status: { in: ["active", "draft"] } },
    orderBy: [{ status: "asc" }, { startDate: "asc" }, { createdAt: "desc" }],
  });
  return plan ? serializeStagePlan(plan) : null;
}

export async function createStagePlan(input: SaveStagePlanInput, actorId: string): Promise<StagePlanDto> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = buildPersistentCreateFingerprint("stage-plan-create-v1", {
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
    goal: input.goal,
    mode: input.mode ?? "maintain",
    status: input.status ?? "draft",
    baseRevision: input.baseRevision,
  });
  try {
    return await prisma.$transaction(async (tx) => {
      const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
      const command = {
        actorId,
        workspaceId: workspace.id,
        action: "STAGE_PLAN_CREATED",
        entityType: "StagePlan",
        idempotencyKey,
        requestFingerprint,
        conflictCode: "STAGE_PLAN_IDEMPOTENCY_CONFLICT",
      };
      const replay = await findPersistentCreateReplay(tx, command);
      if (replay) {
        const snapshot = parseStagePlanSnapshot(replay.resultSnapshot);
        if (snapshot) return snapshot;
        const storedPlan = await tx.stagePlan.findFirst({ where: { id: replay.resultId, workspaceId: workspace.id } });
        if (!storedPlan) throw new ApiError("STAGE_PLAN_IDEMPOTENCY_RESULT_UNAVAILABLE", 409);
        return serializeStagePlan(storedPlan);
      }

      const current = await tx.stagePlan.findFirst({
        where: { workspaceId: workspace.id, status: { in: ["active", "draft"] } },
        orderBy: [{ status: "asc" }, { startDate: "asc" }, { createdAt: "desc" }],
      });
      if (current) {
        throw new ApiError("STAGE_PLAN_BASE_REVISION_CONFLICT", 409, {
          latest: stagePlanConflictLatest(serializeStagePlan(current)),
          conflictFields: ["baseRevision", "plan.revision"],
          workbench: stageWorkbench,
        });
      }

      const created = await tx.stagePlan.create({
        data: {
          workspaceId: workspace.id,
          name: input.name,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
          goal: input.goal,
          mode: input.mode ?? "maintain",
          status: input.status ?? "draft",
        },
      });

      const result = serializeStagePlan(created);
      await recordPersistentCreateResult(tx, command, created.id, {
        status: created.status,
        resultSnapshot: result as unknown as Prisma.InputJsonObject,
      });
      return result;
    });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    const plan = await getCurrentStagePlan(actorId);
    throw new ApiError(error.code, 409, {
      latest: stagePlanConflictLatest(plan, commandStateForCode(error.code), error.details?.latest),
      conflictFields: error.details?.conflictFields?.length ? error.details.conflictFields : ["idempotencyKey"],
      workbench: stageWorkbench,
    });
  }
}

export async function updateStagePlan(
  id: string,
  input: Partial<SaveStagePlanInput> & { expectedRevision: number },
  actorId: string,
): Promise<StagePlanDto> {
  const plan = await prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    const existing = await tx.stagePlan.findFirst({ where: { id, workspaceId: workspace.id } });
    if (!existing) throw new ApiError("STAGE_PLAN_NOT_FOUND", 404);

    const nextStartDate = input.startDate ? new Date(input.startDate) : existing.startDate;
    const nextEndDate = input.endDate ? new Date(input.endDate) : existing.endDate;
    if (nextEndDate.getTime() < nextStartDate.getTime()) throw new ApiError("STAGE_PLAN_DATE_RANGE_INVALID", 400);

    const nextStatus = input.status ?? existing.status;
    if (nextStatus === "active" || nextStatus === "draft") {
      const competingPlan = await tx.stagePlan.findFirst({
        where: {
          id: { not: id },
          workspaceId: workspace.id,
          status: { in: ["active", "draft"] },
        },
        orderBy: [{ status: "asc" }, { startDate: "asc" }, { createdAt: "desc" }],
      });
      if (competingPlan) {
        throw new ApiError("STAGE_PLAN_BASE_REVISION_CONFLICT", 409, {
          latest: stagePlanConflictLatest(serializeStagePlan(competingPlan)),
          conflictFields: ["status", "plan.revision"],
          workbench: stageWorkbench,
        });
      }
    }

    const changed = await tx.stagePlan.updateMany({
      where: { id, workspaceId: workspace.id, revision: input.expectedRevision },
      data: {
        name: input.name,
        startDate: input.startDate ? nextStartDate : undefined,
        endDate: input.endDate ? nextEndDate : undefined,
        goal: input.goal,
        mode: input.mode,
        status: input.status,
        revision: { increment: 1 },
      },
    });
    if (changed.count !== 1) {
      const latest = await tx.stagePlan.findUnique({ where: { id } });
      throw new ApiError("STAGE_PLAN_REVISION_CONFLICT", 409, {
        latest: stagePlanConflictLatest(latest ? serializeStagePlan(latest) : null),
        conflictFields: ["revision"],
        workbench: stageWorkbench,
      });
    }
    const updated = await tx.stagePlan.findUniqueOrThrow({ where: { id } });

    await audit(tx, actorId, "STAGE_PLAN_UPDATED", "StagePlan", id, createStagePlanChangeMetadata(existing, updated));
    return updated;
  });

  return serializeStagePlan(plan);
}

export async function listStageAdjustmentDrafts(actorId: string): Promise<StageAdjustmentDraftRecordDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const drafts = await prisma.stageAdjustmentDraft.findMany({
    where: { workspaceId: workspace.id },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
  });

  return drafts.map(serializeStageAdjustmentDraft);
}

export async function getStageAdjustmentDraft(id: string, actorId: string): Promise<StageAdjustmentDraftRecordDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const draft = await prisma.stageAdjustmentDraft.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!draft) throw new ApiError("STAGE_ADJUSTMENT_DRAFT_NOT_FOUND", 404);
  return serializeStageAdjustmentDraft(draft);
}

export async function getLatestStageAdjustmentDecisionResult(
  actorId: string,
): Promise<StageAdjustmentDecisionReplay | null> {
  const workspace = await resolveActiveWorkspace(actorId);
  const terminalDrafts = await prisma.stageAdjustmentDraft.findMany({
    where: { workspaceId: workspace.id, status: { in: ["applied", "rejected"] } },
    orderBy: { createdAt: "desc" },
  });
  if (terminalDrafts.length === 0) return null;

  const draftsById = new Map(terminalDrafts.map((draft) => [draft.id, draft]));
  const latestAuditEvent = await prisma.auditEvent.findFirst({
    where: {
      actorId,
      entityType: "StageAdjustmentDraft",
      entityId: { in: terminalDrafts.map((draft) => draft.id) },
      action: { in: ["STAGE_ADJUSTMENT_DRAFT_APPLIED", "STAGE_ADJUSTMENT_DRAFT_REJECTED"] },
    },
    orderBy: { createdAt: "desc" },
  });
  const draft = latestAuditEvent?.entityId
    ? draftsById.get(latestAuditEvent.entityId) ?? terminalDrafts[0]
    : terminalDrafts[0];
  const auditEvent = latestAuditEvent?.entityId === draft.id ? latestAuditEvent : null;
  return {
    draft: serializeStageAdjustmentDraft(draft),
    status: draft.status as "applied" | "rejected",
    decidedAt: auditEvent?.createdAt.toISOString() ?? draft.appliedAt?.toISOString() ?? null,
    inboxResult: parseInboxResult(auditEvent?.metadata),
  };
}

export async function createStageAdjustmentDraft(
  input: CreateStageAdjustmentDraftInput,
  actorId: string,
  now = new Date(),
): Promise<StageAdjustmentDraftRecordDto> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const workspace = await resolveActiveWorkspace(actorId);
  const [analytics, latestExam, stagePlan] = await Promise.all([
    getAnalyticsSummary(now, actorId),
    getLatestSimulationExamScoreRate(workspace.id),
    resolveStagePlan(input.stagePlanId, workspace.id),
  ]);
  const adjustment = draftStageAdjustment({
    stageGoal: stagePlan?.goal ?? workspace.stageSummary?.trim() ?? "当前考试目标",
    taskCompletionRate: analytics.totals.weeklyTaskCompletionRate,
    subjectInvestmentBalance: calculateSubjectInvestmentBalance(analytics.subjects),
    mistakeReviewRate: calculateMistakeReviewRate(analytics.totals.totalMistakes, analytics.totals.dueMistakes),
    reviewCompletionRate: analytics.totals.reviewCompletionRate,
    currentStreakDays: analytics.totals.streakDays,
    breakCount: analytics.totals.missedDays,
    lowConversionCount: analytics.totals.lowConversionCount,
    weakSubjectNames: chooseFocusSubjects(analytics.subjects),
    simulationScoreRate: latestExam,
    daysToFinal: optionalDaysUntil(workspace.targetExamDate, now),
  });
  const requestFingerprint = buildPersistentCreateFingerprint("stage-adjustment-draft-create-v1", {
    stagePlanId: input.stagePlanId ?? null,
  });

  try {
    return await prisma.$transaction(async (tx) => {
      const activeWorkspace = await lockActiveWorkspaceForWrite(tx, actorId);
      if (activeWorkspace.id !== workspace.id) {
        throw new ApiError("ACTIVE_WORKSPACE_CHANGED", 409, {
          latest: { workspaceId: activeWorkspace.id },
          conflictFields: ["workspaceId"],
        });
      }
      const command = {
        actorId,
        workspaceId: workspace.id,
        action: "STAGE_ADJUSTMENT_DRAFT_CREATED",
        entityType: "StageAdjustmentDraft",
        idempotencyKey,
        requestFingerprint,
        conflictCode: "STAGE_ADJUSTMENT_DRAFT_IDEMPOTENCY_CONFLICT",
      };
      const replay = await findPersistentCreateReplay(tx, command);
      if (replay) {
        const snapshot = parseStageAdjustmentDraftSnapshot(replay.resultSnapshot);
        if (snapshot) return snapshot;
        const storedDraft = await tx.stageAdjustmentDraft.findFirst({
          where: { id: replay.resultId, workspaceId: workspace.id },
        });
        if (!storedDraft) throw new ApiError("STAGE_ADJUSTMENT_DRAFT_IDEMPOTENCY_RESULT_UNAVAILABLE", 409);
        return serializeStageAdjustmentDraft(storedDraft);
      }

      const created = await tx.stageAdjustmentDraft.create({
        data: {
          workspaceId: workspace.id,
          stagePlanId: stagePlan?.id ?? null,
          originVersion: null,
          sourceReportDecisionId: null,
          sourceReportRevision: null,
          source: "local_rule",
          mode: adjustment.mode,
          risk: adjustment.risk,
          riskConclusion: adjustment.riskConclusion,
          focusSubjects: adjustment.focusSubjects as Prisma.InputJsonValue,
          taskIntensity: adjustment.taskIntensity,
          taskAdjustmentActions: adjustment.taskAdjustmentActions as Prisma.InputJsonValue,
          nextStageEmphasis: adjustment.nextStageEmphasis,
          canAutoApply: false,
          requiresUserConfirmation: true,
          status: "draft",
          actorId,
        },
      });

      const response = serializeStageAdjustmentDraft(created);
      await recordPersistentCreateResult(tx, command, created.id, {
        source: created.source,
        stagePlanId: created.stagePlanId,
        canAutoApply: false,
        requiresUserConfirmation: true,
        resultSnapshot: response as unknown as Prisma.InputJsonObject,
      });
      return response;
    });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    const latest = await loadStageAdjustmentConflictLatest(actorId, stagePlan?.id ?? null);
    throw new ApiError(error.code, 409, {
      latest: {
        ...latest,
        commandState: commandStateForCode(error.code),
        ...(error.details?.latest === undefined ? {} : { sourceConflict: error.details.latest }),
      },
      conflictFields: error.details?.conflictFields?.length ? error.details.conflictFields : ["idempotencyKey"],
      workbench: stageWorkbench,
    });
  }
}

function parseStagePlanSnapshot(value: Prisma.JsonValue | undefined): StagePlanDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return typeof value.id === "string" && typeof value.revision === "number"
    ? value as unknown as StagePlanDto
    : null;
}

function parseStageAdjustmentDraftSnapshot(
  value: Prisma.JsonValue | undefined,
): StageAdjustmentDraftRecordDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return typeof value.id === "string" && typeof value.revision === "number"
    ? value as unknown as StageAdjustmentDraftRecordDto
    : null;
}

export async function confirmStageAdjustmentDraft(id: string, expectedRevision: number, actorId: string): Promise<StageAdjustmentDecisionResult> {
  const workspace = await resolveActiveWorkspace(actorId);
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.stageAdjustmentDraft.findFirst({ where: { id, workspaceId: workspace.id }, include: { stagePlan: true } });
      if (!existing) throw new ApiError("STAGE_ADJUSTMENT_DRAFT_NOT_FOUND", 404);
      if (existing.status === "applied") {
        const inboxResult = await readAppliedStageInboxResult(tx, existing.id);
        if (!inboxResult) throw stageDecisionResultUnavailable(existing);
        return { draft: serializeStageAdjustmentDraft(existing), stageDraftId: existing.id, inboxResult };
      }
      const current = stageAdjustmentConflictLatest(
        serializeStageAdjustmentDraft(existing),
        existing.stagePlan ? serializeStagePlan(existing.stagePlan) : null,
      );
      if (existing.status === "rejected") {
        throw new ApiError("STAGE_ADJUSTMENT_DRAFT_REJECTED", 409, {
          latest: current,
          conflictFields: ["draft.status"],
          workbench: stageWorkbench,
        });
      }
      if (existing.revision !== expectedRevision) {
        throw new ApiError("STAGE_ADJUSTMENT_DRAFT_REVISION_CONFLICT", 409, {
          latest: current,
          conflictFields: ["draft.revision"],
          workbench: stageWorkbench,
        });
      }
      if (!existing.stagePlan) throw new ApiError("STAGE_PLAN_REQUIRED", 400);
      const newerDraft = await tx.stageAdjustmentDraft.findFirst({
      where: {
        workspaceId: workspace.id,
        stagePlanId: existing.stagePlan.id,
        status: "draft",
        createdAt: { gt: existing.createdAt },
      },
      orderBy: { createdAt: "desc" },
    });
      if (newerDraft) {
        throw new ApiError("STAGE_ADJUSTMENT_DRAFT_SUPERSEDED", 409, {
          latest: stageAdjustmentConflictLatest(
            serializeStageAdjustmentDraft(newerDraft),
            serializeStagePlan(existing.stagePlan),
          ),
          conflictFields: ["draft.id", "draft.originVersion"],
          workbench: stageWorkbench,
        });
      }

      const claimed = await tx.stageAdjustmentDraft.updateMany({
      where: { id, workspaceId: workspace.id, status: "draft", revision: expectedRevision },
      data: { status: "applied", appliedAt: new Date(), actorId, revision: { increment: 1 } },
    });
      if (claimed.count !== 1) {
        const latest = await tx.stageAdjustmentDraft.findUnique({ where: { id } });
        if (latest?.status === "applied") {
          const inboxResult = await readAppliedStageInboxResult(tx, latest.id);
          if (!inboxResult) throw stageDecisionResultUnavailable(latest);
          return { draft: serializeStageAdjustmentDraft(latest), stageDraftId: latest.id, inboxResult };
        }
        throw new ApiError("STAGE_ADJUSTMENT_DRAFT_CONFLICT", 409, {
          latest: stageAdjustmentConflictLatest(
            latest ? serializeStageAdjustmentDraft(latest) : serializeStageAdjustmentDraft(existing),
            serializeStagePlan(existing.stagePlan),
          ),
          conflictFields: ["draft.status", "draft.revision"],
          workbench: stageWorkbench,
        });
      }

      const planUpdate = await tx.stagePlan.updateMany({
      where: { id: existing.stagePlan.id, workspaceId: workspace.id, revision: existing.stagePlan.revision },
      data: {
        mode: existing.mode,
        goal: existing.nextStageEmphasis,
        status: existing.stagePlan.status === "draft" ? "active" : existing.stagePlan.status,
        revision: { increment: 1 },
      },
    });
      if (planUpdate.count !== 1) {
        const latest = await tx.stagePlan.findUnique({ where: { id: existing.stagePlan.id } });
        throw new ApiError("STAGE_PLAN_REVISION_CONFLICT", 409, {
          latest: stageAdjustmentConflictLatest(
            serializeStageAdjustmentDraft(existing),
            latest ? serializeStagePlan(latest) : null,
          ),
          conflictFields: ["stagePlan.revision"],
          workbench: stageWorkbench,
        });
      }
      const [updatedPlan, updatedDraft] = await Promise.all([
      tx.stagePlan.findUniqueOrThrow({ where: { id: existing.stagePlan.id } }),
      tx.stageAdjustmentDraft.findUniqueOrThrow({ where: { id } }),
    ]);
      const actions = parseStringArray(existing.taskAdjustmentActions);
      const inboxWrites: PlanInboxWriteResult[] = [];
      const sourceReport = existing.sourceReportDecisionId
      ? await tx.periodicReportDecision.findFirst({ where: { id: existing.sourceReportDecisionId, workspaceId: workspace.id } })
      : null;
      for (const [index, action] of actions.entries()) {
      const originKey = sourceReport
        ? `report:${sourceReport.kind}:${sourceReport.rangeStart.toISOString()}:${index}`
        : `stage:${existing.id}:${index}`;
      const write = await createPlanInboxItemWithResult(tx, workspace.id, actorId, {
        stableKey: `${existing.id}:action:${index}`,
        originKey,
        originVersion: existing.originVersion ?? existing.sourceReportRevision ?? 1,
        originType: "STAGE_ADJUSTMENT",
        originSnapshot: {
          draftId: existing.id,
          action,
          stagePlanId: updatedPlan.id,
          sourceReportDecisionId: existing.sourceReportDecisionId,
          sourceReportRevision: existing.sourceReportRevision,
        },
        title: labelStageInboxAction(action),
        estimatedMinutes: 30,
        priority: existing.risk === "critical" ? "critical" : "high",
        type: "review",
      });
        inboxWrites.push(write);
      }

      const inboxResult = summarizeInboxWrites(inboxWrites);
      await audit(tx, actorId, "STAGE_ADJUSTMENT_DRAFT_APPLIED", "StageAdjustmentDraft", id, {
      stagePlanId: updatedPlan.id,
      decisionStatus: "applied",
      decidedAt: new Date().toISOString(),
      inboxResult: inboxResult as unknown as Prisma.InputJsonObject,
      canAutoApply: false,
      requiresUserConfirmation: true,
      before: createStagePlanSnapshot(existing.stagePlan),
      after: createStagePlanSnapshot(updatedPlan),
    });
      return {
        draft: serializeStageAdjustmentDraft(updatedDraft),
        stageDraftId: updatedDraft.id,
        inboxResult,
      };
    });
  } catch (error) {
    throw await enrichStageAdjustmentConflict(error, actorId, id);
  }
}

export async function rejectStageAdjustmentDraft(id: string, expectedRevision: number, actorId: string): Promise<StageAdjustmentDecisionResult> {
  const workspace = await resolveActiveWorkspace(actorId);
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.stageAdjustmentDraft.findFirst({ where: { id, workspaceId: workspace.id }, include: { stagePlan: true } });
      if (!existing) throw new ApiError("STAGE_ADJUSTMENT_DRAFT_NOT_FOUND", 404);
      if (existing.status === "rejected") {
        return { draft: serializeStageAdjustmentDraft(existing), stageDraftId: existing.id, inboxResult: emptyInboxResult() };
      }
      const current = stageAdjustmentConflictLatest(
        serializeStageAdjustmentDraft(existing),
        existing.stagePlan ? serializeStagePlan(existing.stagePlan) : null,
      );
      if (existing.status === "applied") {
        throw new ApiError("STAGE_ADJUSTMENT_DRAFT_APPLIED", 409, {
          latest: current,
          conflictFields: ["draft.status"],
          workbench: stageWorkbench,
        });
      }
      if (existing.revision !== expectedRevision) {
        throw new ApiError("STAGE_ADJUSTMENT_DRAFT_REVISION_CONFLICT", 409, {
          latest: current,
          conflictFields: ["draft.revision"],
          workbench: stageWorkbench,
        });
      }

      const changed = await tx.stageAdjustmentDraft.updateMany({
      where: { id, workspaceId: workspace.id, status: "draft", revision: expectedRevision },
      data: { status: "rejected", actorId, revision: { increment: 1 } },
    });
      if (changed.count !== 1) {
        const latest = await tx.stageAdjustmentDraft.findUnique({ where: { id } });
        if (latest?.status === "rejected") {
          return { draft: serializeStageAdjustmentDraft(latest), stageDraftId: latest.id, inboxResult: emptyInboxResult() };
        }
        throw new ApiError("STAGE_ADJUSTMENT_DRAFT_CONFLICT", 409, {
          latest: stageAdjustmentConflictLatest(
            latest ? serializeStageAdjustmentDraft(latest) : serializeStageAdjustmentDraft(existing),
            existing.stagePlan ? serializeStagePlan(existing.stagePlan) : null,
          ),
          conflictFields: ["draft.status", "draft.revision"],
          workbench: stageWorkbench,
        });
      }
      const rejected = await tx.stageAdjustmentDraft.findUniqueOrThrow({ where: { id } });

      await audit(tx, actorId, "STAGE_ADJUSTMENT_DRAFT_REJECTED", "StageAdjustmentDraft", id, {
      stagePlanId: rejected.stagePlanId,
      decisionStatus: "rejected",
      decidedAt: new Date().toISOString(),
      inboxResult: emptyInboxResult() as unknown as Prisma.InputJsonObject,
      canAutoApply: false,
      requiresUserConfirmation: true,
    });
      return { draft: serializeStageAdjustmentDraft(rejected), stageDraftId: rejected.id, inboxResult: emptyInboxResult() };
    });
  } catch (error) {
    throw await enrichStageAdjustmentConflict(error, actorId, id);
  }
}

function stagePlanConflictLatest(
  plan: StagePlanDto | null,
  commandState?: StagePlanConflictLatest["commandState"],
  sourceConflict?: unknown,
): StagePlanConflictLatest {
  return {
    kind: "stage-plan",
    plan,
    ...(commandState ? { commandState } : {}),
    ...(sourceConflict === undefined ? {} : { sourceConflict }),
  };
}

function stageAdjustmentConflictLatest(
  draft: StageAdjustmentDraftRecordDto | null,
  stagePlan: StagePlanDto | null,
): StageAdjustmentConflictLatest {
  return { kind: "stage-adjustment-decision", draft, stagePlan };
}

function commandStateForCode(code: string): NonNullable<StagePlanConflictLatest["commandState"]> {
  if (code === "ACTIVE_WORKSPACE_CHANGED") return "workspace_changed";
  if (code.includes("RESULT_UNAVAILABLE")) return "result_unavailable";
  return "conflict";
}

async function loadStageAdjustmentConflictLatest(
  actorId: string,
  stagePlanId: string | null,
): Promise<StageAdjustmentConflictLatest> {
  const workspace = await resolveActiveWorkspace(actorId);
  const [draft, stagePlan] = await Promise.all([
    prisma.stageAdjustmentDraft.findFirst({
      where: {
        workspaceId: workspace.id,
        status: "draft",
        ...(stagePlanId ? { stagePlanId } : {}),
      },
      orderBy: { createdAt: "desc" },
    }),
    stagePlanId
      ? prisma.stagePlan.findFirst({ where: { id: stagePlanId, workspaceId: workspace.id } })
      : prisma.stagePlan.findFirst({
          where: { workspaceId: workspace.id, status: { in: ["active", "draft"] } },
          orderBy: [{ status: "asc" }, { startDate: "asc" }, { createdAt: "desc" }],
        }),
  ]);
  return stageAdjustmentConflictLatest(
    draft ? serializeStageAdjustmentDraft(draft) : null,
    stagePlan ? serializeStagePlan(stagePlan) : null,
  );
}

async function enrichStageAdjustmentConflict(error: unknown, actorId: string, draftId: string): Promise<unknown> {
  if (!(error instanceof ApiError) || error.status !== 409) return error;
  if (isStageAdjustmentConflictLatest(error.details?.latest)) {
    return new ApiError(error.code, 409, {
      latest: error.details.latest,
      conflictFields: error.details?.conflictFields?.length ? error.details.conflictFields : ["draft"],
      workbench: stageWorkbench,
    });
  }
  const workspace = await resolveActiveWorkspace(actorId);
  const draft = await prisma.stageAdjustmentDraft.findFirst({
    where: { id: draftId, workspaceId: workspace.id },
    include: { stagePlan: true },
  });
  return new ApiError(error.code, 409, {
    latest: {
      ...stageAdjustmentConflictLatest(
        draft ? serializeStageAdjustmentDraft(draft) : null,
        draft?.stagePlan ? serializeStagePlan(draft.stagePlan) : null,
      ),
      ...(error.details?.latest === undefined ? {} : { sourceConflict: error.details.latest }),
    },
    conflictFields: error.details?.conflictFields?.length ? error.details.conflictFields : ["draft"],
    workbench: stageWorkbench,
  });
}

function isStageAdjustmentConflictLatest(value: unknown): value is StageAdjustmentConflictLatest {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (value as { kind?: unknown }).kind === "stage-adjustment-decision");
}

function labelStageInboxAction(action: string): string {
  return ({ split: "拆分过大任务", defer: "延期低优先级任务", drop: "移出低价值任务", convert_review: "转为复习行动", simulate: "安排模拟考试", retest: "安排薄弱节点复测" } as Record<string, string>)[action] ?? action;
}

function emptyInboxResult(): PlanInboxWriteSummaryDto {
  return { created: [], reused: [], superseded: [], createdCount: 0, reusedCount: 0, supersededCount: 0 };
}

async function readAppliedStageInboxResult(
  client: StageDbClient,
  draftId: string,
): Promise<PlanInboxWriteSummaryDto | null> {
  const event = await client.auditEvent.findFirst({
    where: {
      entityType: "StageAdjustmentDraft",
      entityId: draftId,
      action: "STAGE_ADJUSTMENT_DRAFT_APPLIED",
    },
    orderBy: { createdAt: "desc" },
  });
  return parseInboxResult(event?.metadata);
}

function parseInboxResult(metadata: Prisma.JsonValue | null | undefined): PlanInboxWriteSummaryDto | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = metadata.inboxResult;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, Prisma.JsonValue>;
  if (![result.createdCount, result.reusedCount, result.supersededCount].every(Number.isInteger)) return null;
  if (![result.created, result.reused, result.superseded].every((entry) =>
    Array.isArray(entry) && entry.every((id) => typeof id === "string"),
  )) return null;
  return {
    created: result.created as string[],
    reused: result.reused as string[],
    superseded: result.superseded as string[],
    createdCount: result.createdCount as number,
    reusedCount: result.reusedCount as number,
    supersededCount: result.supersededCount as number,
  };
}

function stageDecisionResultUnavailable(draft: { id: string; revision: number; status: string }): ApiError {
  return new ApiError("STAGE_ADJUSTMENT_RESULT_UNAVAILABLE", 409, {
    latest: { id: draft.id, revision: draft.revision, status: draft.status },
    conflictFields: ["inboxResult"],
    workbench: stageWorkbench,
  });
}

function summarizeInboxWrites(writes: PlanInboxWriteResult[]): PlanInboxWriteSummaryDto {
  const created = writes.filter((write) => write.created).map((write) => write.item.id);
  const reused = writes.filter((write) => write.reused).map((write) => write.item.id);
  const superseded = writes.flatMap((write) => write.superseded.map((item) => item.id));
  return { created, reused, superseded, createdCount: created.length, reusedCount: reused.length, supersededCount: superseded.length };
}

export async function createDefaultStagePlan(actorId: string, now = new Date()): Promise<StagePlanDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  if (!workspace.targetExamDate) throw new ApiError("TARGET_EXAM_DATE_REQUIRED", 400);
  const range = getStudyDayRange(now);
  return createStagePlan(
    {
      idempotencyKey: `default-stage-plan-${range.start.toISOString()}`,
      baseRevision: null,
      name: `${workspace.name}准备期`,
      startDate: range.start.toISOString(),
      endDate: workspace.targetExamDate.toISOString(),
      goal: workspace.stageSummary?.trim() || `完成${workspace.name}`,
      mode: "maintain",
      status: "active",
    },
    actorId,
  );
}

async function resolveStagePlan(stagePlanId: string | null | undefined, workspaceId: string): Promise<{ id: string; goal: string } | null> {
  if (stagePlanId) {
    const plan = await prisma.stagePlan.findFirst({ where: { id: stagePlanId, workspaceId }, select: { id: true, goal: true } });
    if (!plan) throw new ApiError("STAGE_PLAN_NOT_FOUND", 404);
    return plan;
  }

  return prisma.stagePlan.findFirst({
    where: { workspaceId, status: { in: ["active", "draft"] } },
    orderBy: [{ status: "asc" }, { startDate: "asc" }, { createdAt: "desc" }],
    select: { id: true, goal: true },
  });
}

async function getLatestSimulationExamScoreRate(workspaceId: string): Promise<number | null> {
  const exam = await prisma.simulationExam.findFirst({
    where: { workspaceId, actualScore: { not: null }, targetScore: { not: null }, subjectResults: { some: {} } },
    orderBy: [{ examDate: "desc" }, { updatedAt: "desc" }],
    select: { actualScore: true, targetScore: true },
  });
  if (!exam?.actualScore || !exam.targetScore || exam.targetScore <= 0) return null;
  return exam.actualScore / exam.targetScore;
}

function calculateSubjectInvestmentBalance(subjects: Array<{ totalMinutes: number }>): number | null {
  const total = subjects.reduce((sum, subject) => sum + subject.totalMinutes, 0);
  if (total === 0 || subjects.length === 0) return null;
  const shares = subjects.map((subject) => subject.totalMinutes / total);
  return Math.min(...shares) / Math.max(...shares);
}

function calculateMistakeReviewRate(totalMistakes: number, dueMistakes: number): number | null {
  if (totalMistakes === 0) return null;
  return Math.max(0, Math.min(1, 1 - dueMistakes / totalMistakes));
}

function chooseFocusSubjects(subjects: Array<{ subjectName: string; effectiveMinutes: number; share: number }>): string[] {
  const focus = [...subjects]
    .sort((left, right) => {
      if (left.effectiveMinutes === right.effectiveMinutes) return left.share - right.share;
      return left.effectiveMinutes - right.effectiveMinutes;
    })
    .slice(0, 3)
    .map((subject) => subject.subjectName);

  return focus;
}

function serializeStagePlan(plan: {
  id: string;
  revision: number;
  name: string;
  startDate: Date;
  endDate: Date;
  goal: string;
  mode: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): StagePlanDto {
  return {
    id: plan.id,
    revision: plan.revision,
    name: plan.name,
    startDate: plan.startDate.toISOString(),
    endDate: plan.endDate.toISOString(),
    goal: plan.goal,
    mode: plan.mode as StagePlanDto["mode"],
    status: plan.status as StagePlanDto["status"],
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

function serializeStageAdjustmentDraft(draft: {
  id: string;
  revision: number;
  stagePlanId: string | null;
  sourceReportDecisionId: string | null;
  sourceReportRevision: number | null;
  originVersion: number | null;
  source: string;
  mode: string;
  risk: string;
  riskConclusion: string;
  focusSubjects: unknown;
  taskIntensity: string;
  taskAdjustmentActions: unknown;
  nextStageEmphasis: string;
  canAutoApply: boolean;
  requiresUserConfirmation: boolean;
  status: string;
  createdAt: Date;
  appliedAt: Date | null;
  actorId: string | null;
}): StageAdjustmentDraftRecordDto {
  return {
    id: draft.id,
    revision: draft.revision,
    stagePlanId: draft.stagePlanId,
    sourceReportDecisionId: draft.sourceReportDecisionId,
    sourceReportRevision: draft.sourceReportRevision,
    originVersion: draft.originVersion,
    source: draft.source as StageAdjustmentDraftRecordDto["source"],
    mode: draft.mode as StageAdjustmentDraftRecordDto["mode"],
    risk: draft.risk as StageAdjustmentDraftRecordDto["risk"],
    riskConclusion: draft.riskConclusion,
    focusSubjects: parseStringArray(draft.focusSubjects),
    taskIntensity: draft.taskIntensity as StageAdjustmentDraftRecordDto["taskIntensity"],
    taskAdjustmentActions: parseStringArray(draft.taskAdjustmentActions) as StageAdjustmentTaskActionDto[],
    nextStageEmphasis: draft.nextStageEmphasis,
    canAutoApply: false,
    requiresUserConfirmation: true,
    status: draft.status as StageAdjustmentDraftRecordDto["status"],
    createdAt: draft.createdAt.toISOString(),
    appliedAt: draft.appliedAt?.toISOString() ?? null,
    actorId: draft.actorId,
  };
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function createStagePlanChangeMetadata(before: { mode: string; status: string; goal: string }, after: { mode: string; status: string; goal: string }) {
  return {
    before: createStagePlanSnapshot(before),
    after: createStagePlanSnapshot(after),
  };
}

function createStagePlanSnapshot(plan: { mode: string; status: string; goal: string }) {
  return {
    mode: plan.mode,
    status: plan.status,
    goal: plan.goal,
  };
}

async function audit(
  client: StageDbClient,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Prisma.InputJsonObject,
): Promise<void> {
  // AuditEvent is the only Batch 6 write-side ledger; no task reorder or bulk task mutation is performed here.
  await client.auditEvent.create({
    data: {
      actorId,
      action,
      entityType,
      entityId,
      metadata,
    },
  });
}
