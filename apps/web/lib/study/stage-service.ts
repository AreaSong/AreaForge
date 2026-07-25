import {
  draftStageAdjustment,
  type StageAdjustmentDraft,
} from "@areaforge/core";
import { prisma, type Prisma, type PrismaClient } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getAnalyticsSummary } from "./analytics-service";
import { daysUntil, getStudyDayRange } from "./date";
import { finalExamDate, simulationDate } from "./exam-dates";
import { createPlanInboxItemWithResult, type PlanInboxWriteResult } from "./plan-inbox-service";
import type {
  PlanInboxWriteSummaryDto,
  StageAdjustmentDraftRecordDto,
  StageAdjustmentTaskActionDto,
  StagePlanDto,
} from "./types";
import { resolveActiveWorkspace } from "./exam-workspace-service";

const defaultStageGoal = "2026 年 12 月同步全真自测";

type StageDbClient = PrismaClient | Prisma.TransactionClient;

export interface SaveStagePlanInput {
  name: string;
  startDate: string;
  endDate: string;
  goal: string;
  mode?: StageAdjustmentDraft["mode"];
  status?: StagePlanDto["status"];
}

export interface CreateStageAdjustmentDraftInput {
  stagePlanId?: string | null;
}

export interface StageAdjustmentDecisionResult {
  draft: StageAdjustmentDraftRecordDto;
  stageDraftId: string;
  inboxResult: PlanInboxWriteSummaryDto;
}

export async function listStagePlans(actorId?: string): Promise<StagePlanDto[]> {
  const workspace = actorId ? await resolveActiveWorkspace(actorId) : null;
  const plans = await prisma.stagePlan.findMany({
    where: workspace ? { workspaceId: workspace.id } : undefined,
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
  const workspace = await resolveActiveWorkspace(actorId);
  const plan = await prisma.$transaction(async (tx) => {
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

    await audit(tx, actorId, "STAGE_PLAN_CREATED", "StagePlan", created.id, { status: created.status });
    return created;
  });

  return serializeStagePlan(plan);
}

export async function updateStagePlan(
  id: string,
  input: Partial<SaveStagePlanInput> & { expectedRevision: number },
  actorId: string,
): Promise<StagePlanDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const plan = await prisma.$transaction(async (tx) => {
    const existing = await tx.stagePlan.findFirst({ where: { id, workspaceId: workspace.id } });
    if (!existing) throw new ApiError("STAGE_PLAN_NOT_FOUND", 404);

    const nextStartDate = input.startDate ? new Date(input.startDate) : existing.startDate;
    const nextEndDate = input.endDate ? new Date(input.endDate) : existing.endDate;
    if (nextEndDate.getTime() < nextStartDate.getTime()) throw new ApiError("STAGE_PLAN_DATE_RANGE_INVALID", 400);

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
        latest: latest ? serializeStagePlan(latest) : undefined,
        conflictFields: ["revision"],
      });
    }
    const updated = await tx.stagePlan.findUniqueOrThrow({ where: { id } });

    await audit(tx, actorId, "STAGE_PLAN_UPDATED", "StagePlan", id, createStagePlanChangeMetadata(existing, updated));
    return updated;
  });

  return serializeStagePlan(plan);
}

export async function listStageAdjustmentDrafts(actorId?: string): Promise<StageAdjustmentDraftRecordDto[]> {
  const workspace = actorId ? await resolveActiveWorkspace(actorId) : null;
  const drafts = await prisma.stageAdjustmentDraft.findMany({
    where: workspace ? { workspaceId: workspace.id } : undefined,
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

export async function createStageAdjustmentDraft(
  input: CreateStageAdjustmentDraftInput,
  actorId: string,
  now = new Date(),
): Promise<StageAdjustmentDraftRecordDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const [analytics, latestExam, stagePlan] = await Promise.all([
    getAnalyticsSummary(now, actorId),
    getLatestSimulationExamScoreRate(workspace.id),
    resolveStagePlan(input.stagePlanId, workspace.id),
  ]);
  const adjustment = draftStageAdjustment({
    stageGoal: stagePlan?.goal ?? defaultStageGoal,
    taskCompletionRate: analytics.totals.weeklyTaskCompletionRate,
    subjectInvestmentBalance: calculateSubjectInvestmentBalance(analytics.subjects),
    mistakeReviewRate: calculateMistakeReviewRate(analytics.totals.totalMistakes, analytics.totals.dueMistakes),
    reviewCompletionRate: analytics.totals.reviewCompletionRate,
    currentStreakDays: analytics.totals.streakDays,
    breakCount: analytics.totals.missedDays,
    lowConversionCount: analytics.totals.lowConversionCount,
    weakSubjectNames: chooseFocusSubjects(analytics.subjects),
    simulationScoreRate: latestExam,
    daysToFinal: daysUntil(finalExamDate, now),
  });

  const result = await prisma.$transaction(async (tx) => {
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

    await audit(tx, actorId, "STAGE_ADJUSTMENT_DRAFT_CREATED", "StageAdjustmentDraft", created.id, {
      source: created.source,
      stagePlanId: created.stagePlanId,
      canAutoApply: false,
      requiresUserConfirmation: true,
    });
    return created;
  });

  return serializeStageAdjustmentDraft(result);
}

export async function confirmStageAdjustmentDraft(id: string, expectedRevision: number, actorId: string): Promise<StageAdjustmentDecisionResult> {
  const workspace = await resolveActiveWorkspace(actorId);
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.stageAdjustmentDraft.findFirst({ where: { id, workspaceId: workspace.id }, include: { stagePlan: true } });
    if (!existing) throw new ApiError("STAGE_ADJUSTMENT_DRAFT_NOT_FOUND", 404);
    if (existing.status === "applied") {
      return { draft: serializeStageAdjustmentDraft(existing), stageDraftId: existing.id, inboxResult: emptyInboxResult() };
    }
    if (existing.status === "rejected") throw new ApiError("STAGE_ADJUSTMENT_DRAFT_REJECTED", 409);
    if (existing.revision !== expectedRevision) {
      throw new ApiError("STAGE_ADJUSTMENT_DRAFT_REVISION_CONFLICT", 409, {
        latest: serializeStageAdjustmentDraft(existing),
        conflictFields: ["revision"],
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
        latest: serializeStageAdjustmentDraft(newerDraft),
        conflictFields: ["version"],
      });
    }

    const claimed = await tx.stageAdjustmentDraft.updateMany({
      where: { id, workspaceId: workspace.id, status: "draft", revision: expectedRevision },
      data: { status: "applied", appliedAt: new Date(), actorId, revision: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      const latest = await tx.stageAdjustmentDraft.findUnique({ where: { id } });
      if (latest?.status === "applied") {
        return { draft: serializeStageAdjustmentDraft(latest), stageDraftId: latest.id, inboxResult: emptyInboxResult() };
      }
      throw new ApiError("STAGE_ADJUSTMENT_DRAFT_CONFLICT", 409, {
        latest: latest ? serializeStageAdjustmentDraft(latest) : undefined,
        conflictFields: ["status"],
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
        latest: latest ? serializeStagePlan(latest) : undefined,
        conflictFields: ["revision"],
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

    await audit(tx, actorId, "STAGE_ADJUSTMENT_DRAFT_APPLIED", "StageAdjustmentDraft", id, {
      stagePlanId: updatedPlan.id,
      canAutoApply: false,
      requiresUserConfirmation: true,
      before: createStagePlanSnapshot(existing.stagePlan),
      after: createStagePlanSnapshot(updatedPlan),
    });
    return {
      draft: serializeStageAdjustmentDraft(updatedDraft),
      stageDraftId: updatedDraft.id,
      inboxResult: summarizeInboxWrites(inboxWrites),
    };
  });
  return result;
}

export async function rejectStageAdjustmentDraft(id: string, expectedRevision: number, actorId: string): Promise<StageAdjustmentDecisionResult> {
  const workspace = await resolveActiveWorkspace(actorId);
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.stageAdjustmentDraft.findFirst({ where: { id, workspaceId: workspace.id } });
    if (!existing) throw new ApiError("STAGE_ADJUSTMENT_DRAFT_NOT_FOUND", 404);
    if (existing.status === "rejected") {
      return { draft: serializeStageAdjustmentDraft(existing), stageDraftId: existing.id, inboxResult: emptyInboxResult() };
    }
    if (existing.status === "applied") throw new ApiError("STAGE_ADJUSTMENT_DRAFT_APPLIED", 409);
    if (existing.revision !== expectedRevision) {
      throw new ApiError("STAGE_ADJUSTMENT_DRAFT_REVISION_CONFLICT", 409, {
        latest: serializeStageAdjustmentDraft(existing),
        conflictFields: ["revision"],
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
        latest: latest ? serializeStageAdjustmentDraft(latest) : undefined,
        conflictFields: ["status"],
      });
    }
    const rejected = await tx.stageAdjustmentDraft.findUniqueOrThrow({ where: { id } });

    await audit(tx, actorId, "STAGE_ADJUSTMENT_DRAFT_REJECTED", "StageAdjustmentDraft", id, {
      stagePlanId: rejected.stagePlanId,
      canAutoApply: false,
      requiresUserConfirmation: true,
    });
    return { draft: serializeStageAdjustmentDraft(rejected), stageDraftId: rejected.id, inboxResult: emptyInboxResult() };
  });
  return result;
}

function labelStageInboxAction(action: string): string {
  return ({ split: "拆分过大任务", defer: "延期低优先级任务", drop: "移出低价值任务", convert_review: "转为复习行动", simulate: "安排阶段模拟", retest: "安排薄弱节点复测" } as Record<string, string>)[action] ?? action;
}

function emptyInboxResult(): PlanInboxWriteSummaryDto {
  return { created: [], reused: [], superseded: [], createdCount: 0, reusedCount: 0, supersededCount: 0 };
}

function summarizeInboxWrites(writes: PlanInboxWriteResult[]): PlanInboxWriteSummaryDto {
  const created = writes.filter((write) => write.created).map((write) => write.item.id);
  const reused = writes.filter((write) => write.reused).map((write) => write.item.id);
  const superseded = writes.flatMap((write) => write.superseded.map((item) => item.id));
  return { created, reused, superseded, createdCount: created.length, reusedCount: reused.length, supersededCount: superseded.length };
}

export async function createDefaultStagePlan(actorId: string, now = new Date()): Promise<StagePlanDto> {
  const range = getStudyDayRange(now);
  return createStagePlan(
    {
      name: "2026 同步全真自测准备期",
      startDate: range.start.toISOString(),
      endDate: simulationDate.toISOString(),
      goal: defaultStageGoal,
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

function calculateSubjectInvestmentBalance(subjects: Array<{ totalMinutes: number }>): number {
  const total = subjects.reduce((sum, subject) => sum + subject.totalMinutes, 0);
  if (total === 0 || subjects.length === 0) return 0;
  const shares = subjects.map((subject) => subject.totalMinutes / total);
  return Math.min(...shares) / Math.max(...shares);
}

function calculateMistakeReviewRate(totalMistakes: number, dueMistakes: number): number {
  if (totalMistakes === 0) return 1;
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

  return focus.length > 0 ? focus : ["数学", "英语", "408"];
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
