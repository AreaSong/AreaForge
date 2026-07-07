import {
  draftStageAdjustment,
  type StageAdjustmentDraft,
} from "@areaforge/core";
import { prisma, type Prisma, type PrismaClient } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getAnalyticsSummary } from "./analytics-service";
import { daysUntil, getStudyDayRange } from "./date";
import type {
  StageAdjustmentDraftRecordDto,
  StageAdjustmentTaskActionDto,
  StagePlanDto,
} from "./types";

const simulationDate = new Date("2026-12-20T08:30:00+08:00");
const finalExamDate = new Date("2027-12-20T08:30:00+08:00");
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

export async function listStagePlans(): Promise<StagePlanDto[]> {
  const plans = await prisma.stagePlan.findMany({
    orderBy: [{ status: "asc" }, { startDate: "asc" }, { createdAt: "desc" }],
    take: 50,
  });

  return plans.map(serializeStagePlan);
}

export async function createStagePlan(input: SaveStagePlanInput, actorId: string): Promise<StagePlanDto> {
  const plan = await prisma.$transaction(async (tx) => {
    const created = await tx.stagePlan.create({
      data: {
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

export async function updateStagePlan(id: string, input: Partial<SaveStagePlanInput>, actorId: string): Promise<StagePlanDto> {
  const plan = await prisma.$transaction(async (tx) => {
    const existing = await tx.stagePlan.findUnique({ where: { id } });
    if (!existing) throw new ApiError("STAGE_PLAN_NOT_FOUND", 404);

    const nextStartDate = input.startDate ? new Date(input.startDate) : existing.startDate;
    const nextEndDate = input.endDate ? new Date(input.endDate) : existing.endDate;
    if (nextEndDate.getTime() < nextStartDate.getTime()) throw new ApiError("STAGE_PLAN_DATE_RANGE_INVALID", 400);

    const updated = await tx.stagePlan.update({
      where: { id },
      data: {
        name: input.name,
        startDate: input.startDate ? nextStartDate : undefined,
        endDate: input.endDate ? nextEndDate : undefined,
        goal: input.goal,
        mode: input.mode,
        status: input.status,
      },
    });

    await audit(tx, actorId, "STAGE_PLAN_UPDATED", "StagePlan", id, createStagePlanChangeMetadata(existing, updated));
    return updated;
  });

  return serializeStagePlan(plan);
}

export async function listStageAdjustmentDrafts(): Promise<StageAdjustmentDraftRecordDto[]> {
  const drafts = await prisma.stageAdjustmentDraft.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 50,
  });

  return drafts.map(serializeStageAdjustmentDraft);
}

export async function createStageAdjustmentDraft(
  input: CreateStageAdjustmentDraftInput,
  actorId: string,
  now = new Date(),
): Promise<StageAdjustmentDraftRecordDto> {
  const [analytics, latestExam, stagePlan] = await Promise.all([
    getAnalyticsSummary(now),
    getLatestSimulationExamScoreRate(),
    resolveStagePlan(input.stagePlanId),
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

  const draft = await prisma.$transaction(async (tx) => {
    const created = await tx.stageAdjustmentDraft.create({
      data: {
        stagePlanId: stagePlan?.id ?? null,
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

  return serializeStageAdjustmentDraft(draft);
}

export async function confirmStageAdjustmentDraft(id: string, actorId: string): Promise<StageAdjustmentDraftRecordDto> {
  const draft = await prisma.$transaction(async (tx) => {
    const existing = await tx.stageAdjustmentDraft.findUnique({ where: { id }, include: { stagePlan: true } });
    if (!existing) throw new ApiError("STAGE_ADJUSTMENT_DRAFT_NOT_FOUND", 404);
    if (existing.status === "applied") return existing;
    if (existing.status === "rejected") throw new ApiError("STAGE_ADJUSTMENT_DRAFT_REJECTED", 409);
    if (!existing.stagePlan) throw new ApiError("STAGE_PLAN_REQUIRED", 400);

    const updatedPlan = await tx.stagePlan.update({
      where: { id: existing.stagePlan.id },
      data: {
        mode: existing.mode,
        goal: existing.nextStageEmphasis,
        status: existing.stagePlan.status === "draft" ? "active" : existing.stagePlan.status,
      },
    });
    const updatedDraft = await tx.stageAdjustmentDraft.update({
      where: { id },
      data: { status: "applied", appliedAt: new Date(), actorId },
    });

    await audit(tx, actorId, "STAGE_ADJUSTMENT_DRAFT_APPLIED", "StageAdjustmentDraft", id, {
      stagePlanId: updatedPlan.id,
      canAutoApply: false,
      requiresUserConfirmation: true,
      before: createStagePlanSnapshot(existing.stagePlan),
      after: createStagePlanSnapshot(updatedPlan),
    });
    return updatedDraft;
  });

  return serializeStageAdjustmentDraft(draft);
}

export async function rejectStageAdjustmentDraft(id: string, actorId: string): Promise<StageAdjustmentDraftRecordDto> {
  const draft = await prisma.$transaction(async (tx) => {
    const existing = await tx.stageAdjustmentDraft.findUnique({ where: { id } });
    if (!existing) throw new ApiError("STAGE_ADJUSTMENT_DRAFT_NOT_FOUND", 404);
    if (existing.status === "rejected") return existing;
    if (existing.status === "applied") throw new ApiError("STAGE_ADJUSTMENT_DRAFT_APPLIED", 409);

    const rejected = await tx.stageAdjustmentDraft.update({
      where: { id },
      data: { status: "rejected", actorId },
    });

    await audit(tx, actorId, "STAGE_ADJUSTMENT_DRAFT_REJECTED", "StageAdjustmentDraft", id, {
      stagePlanId: rejected.stagePlanId,
      canAutoApply: false,
      requiresUserConfirmation: true,
    });
    return rejected;
  });

  return serializeStageAdjustmentDraft(draft);
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

async function resolveStagePlan(stagePlanId?: string | null): Promise<{ id: string; goal: string } | null> {
  if (stagePlanId) {
    const plan = await prisma.stagePlan.findUnique({ where: { id: stagePlanId }, select: { id: true, goal: true } });
    if (!plan) throw new ApiError("STAGE_PLAN_NOT_FOUND", 404);
    return plan;
  }

  return prisma.stagePlan.findFirst({
    where: { status: { in: ["active", "draft"] } },
    orderBy: [{ status: "asc" }, { startDate: "asc" }, { createdAt: "desc" }],
    select: { id: true, goal: true },
  });
}

async function getLatestSimulationExamScoreRate(): Promise<number | null> {
  const exam = await prisma.simulationExam.findFirst({
    where: { actualScore: { not: null }, targetScore: { not: null } },
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
  stagePlanId: string | null;
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
    stagePlanId: draft.stagePlanId,
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
