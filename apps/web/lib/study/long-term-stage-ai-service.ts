import {
  createFallbackStageAdjustmentAdvice,
  generateAdviceWithProvider,
  validateStageAdjustmentAdvice,
  type AiAdviceStatus,
  type AiJsonProvider,
  type StageAdjustmentAdvice,
  type StageAdjustmentContext,
} from "@areaforge/ai";
import { prisma, type Prisma } from "@areaforge/db";
import { getAnalyticsSummary } from "./analytics-service";
import { resolveConfiguredAiProviderForUser } from "./ai-service";
import { ApiError } from "@/lib/api/responses";
import { daysUntil } from "./date";
import { lockActiveWorkspaceForWrite, resolveActiveWorkspace } from "./exam-workspace-service";
import {
  buildPersistentCreateFingerprint,
  claimPersistentCreateCommand,
  completePersistentCreateClaim,
  normalizeIdempotencyKey,
  type PersistentCreateCommand,
  type PersistentCreateReplay,
} from "./persistent-idempotency";
import { createStageAdjustmentDraft, type CreateStageAdjustmentDraftInput } from "./stage-service";
import type { StageAdjustmentDraftRecordDto } from "@/lib/contracts";

const defaultStageGoal = "2026 年 12 月同步全真自测";
const stageGoalSummaryMaxLength = 120;
const staleEvidenceDays = 30;
const dayMs = 24 * 60 * 60 * 1000;

type ScopedStageAdjustmentContext = StageAdjustmentContext & {
  workspaceId: string;
  stagePlanId: string;
};

export interface CreateAiStageAdjustmentDraftOptions {
  allowExternalProvider?: boolean;
  provider?: AiJsonProvider;
  userId?: string;
  now?: Date;
}

export interface AiStageAdjustmentDraftResult {
  draft: StageAdjustmentDraftRecordDto;
  ai: {
    status: AiAdviceStatus;
    externalCall: boolean;
    fallbackToLocalRule: boolean;
    reason: string;
  };
}

export async function createAiStageAdjustmentDraft(
  input: CreateStageAdjustmentDraftInput,
  actorId: string,
  options: CreateAiStageAdjustmentDraftOptions = {},
): Promise<AiStageAdjustmentDraftResult> {
  const now = options.now ?? new Date();
  const context = await minimizedLongTermStageContext(input, actorId, now);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const command: PersistentCreateCommand = {
    actorId,
    workspaceId: context.workspaceId,
    action: "AI_STAGE_ADJUSTMENT_DRAFT_CREATED",
    entityType: "StageAdjustmentDraft",
    idempotencyKey,
    requestFingerprint: buildPersistentCreateFingerprint("ai-stage-adjustment-draft-create-v1", {
      stagePlanId: input.stagePlanId ?? null,
    }),
    conflictCode: "AI_STAGE_ADJUSTMENT_DRAFT_IDEMPOTENCY_CONFLICT",
  };
  const claim = await prisma.$transaction((tx) => claimPersistentCreateCommand(tx, command));
  if (claim.state === "pending") {
    throw new ApiError("AI_STAGE_ADJUSTMENT_DRAFT_IN_PROGRESS", 409, {
      latest: { state: "pending" },
      conflictFields: ["idempotencyKey"],
    });
  }
  if (claim.state === "replayed") {
    return replayAiStageAdjustmentDraft(claim.replay, context.workspaceId);
  }

  const provider = await resolveConfiguredAiProviderForUser("stage_adjustment", {
    allowExternalProvider: options.allowExternalProvider,
    provider: options.provider,
    userId: options.userId ?? actorId,
  });
  const result = await generateAdviceWithProvider({
    kind: "stage_adjustment",
    context,
    provider: provider.provider,
    providerUnavailableReason: provider.unavailableReason,
    fallback: createFallbackStageAdjustmentAdvice,
    validate: validateStageAdjustmentAdvice,
  });
  const ai = {
    status: result.meta.status,
    externalCall: result.meta.externalCall,
    fallbackToLocalRule: result.meta.status !== "ai_generated",
    reason: result.meta.reason,
  };
  const draft = await persistClaimedAiStageAdjustmentDraft({
    advice: result.advice,
    context,
    actorId,
    externalCall: result.meta.externalCall,
    source: result.meta.status === "ai_generated" ? "ai" : "local_rule",
    command,
    claimEventId: claim.claimEventId,
    ai,
  });

  return { draft, ai };
}

export async function minimizedLongTermStageContext(
  input: CreateStageAdjustmentDraftInput,
  actorId: string,
  now = new Date(),
): Promise<ScopedStageAdjustmentContext> {
  const workspace = await resolveActiveWorkspace(actorId);
  const [analytics, stagePlan, latestExam, weakNodeSummary] = await Promise.all([
    getAnalyticsSummary(now, actorId),
    resolveStagePlan(input.stagePlanId, workspace.id),
    getLatestSimulationSummary(workspace.id),
    summarizeWeakNodes(now, workspace.id),
  ]);
  if (!stagePlan) throw new ApiError("STAGE_PLAN_REQUIRED", 400);

  return {
    rangeKind: "week",
    rangeStart: analytics.range.start,
    rangeEnd: analytics.range.end,
    rangeDays: analytics.range.days,
    workspaceId: workspace.id,
    stagePlanId: stagePlan.id,
    stageGoalSummary: summarizeStageGoal(stagePlan.goal ?? defaultStageGoal),
    effectiveMinutes: analytics.totals.weekEffectiveMinutes,
    taskCompletionRate: analytics.totals.weeklyTaskCompletionRate,
    reviewCompletionRate: analytics.totals.reviewCompletionRate,
    lowConversionCount: analytics.totals.lowConversionCount,
    subjectShares: analytics.subjects.map((subject) => ({
      subjectName: subject.subjectName,
      effectiveMinutes: subject.effectiveMinutes,
      share: Math.round(subject.share) / 100,
    })),
    weakNodeSummary,
    simulationSummary: latestExam,
    stagePlanMode: stagePlan.mode,
    stagePlanStatus: stagePlan.status,
    daysToStageEnd: daysUntil(stagePlan.endDate, now),
    riskTags: createRiskTags(analytics, latestExam, stagePlan, now),
  };
}

export async function fallbackToLocalRule(
  input: CreateStageAdjustmentDraftInput,
  actorId: string,
  status: AiAdviceStatus,
  reason: string,
  now = new Date(),
  externalCall = false,
): Promise<AiStageAdjustmentDraftResult> {
  const draft = await createStageAdjustmentDraft(input, actorId, now);

  return {
    draft,
    ai: {
      status,
      externalCall,
      fallbackToLocalRule: true,
      reason,
    },
  };
}

async function persistClaimedAiStageAdjustmentDraft(input: {
  advice: StageAdjustmentAdvice;
  context: ScopedStageAdjustmentContext;
  actorId: string;
  externalCall: boolean;
  source: "ai" | "local_rule";
  command: PersistentCreateCommand;
  claimEventId: string;
  ai: AiStageAdjustmentDraftResult["ai"];
}): Promise<StageAdjustmentDraftRecordDto> {
  const draft = await prisma.$transaction(async (tx) => {
    const activeWorkspace = await lockActiveWorkspaceForWrite(tx, input.actorId);
    if (activeWorkspace.id !== input.context.workspaceId) {
      throw new ApiError("ACTIVE_WORKSPACE_CHANGED", 409);
    }
    const stagePlan = await tx.stagePlan.findFirst({
      where: {
        id: input.context.stagePlanId,
        workspaceId: activeWorkspace.id,
        status: { in: ["active", "draft"] },
      },
      select: { id: true },
    });
    if (!stagePlan) throw new ApiError("STAGE_PLAN_NOT_FOUND", 404);

    const created = await tx.stageAdjustmentDraft.create({
      data: {
        workspaceId: activeWorkspace.id,
        stagePlanId: stagePlan.id,
        source: input.source,
        mode: input.advice.mode,
        risk: input.advice.risk,
        riskConclusion: input.advice.riskConclusion,
        focusSubjects: input.advice.focusSubjects as Prisma.InputJsonValue,
        taskIntensity: input.advice.taskIntensity,
        taskAdjustmentActions: input.advice.taskAdjustmentActions as Prisma.InputJsonValue,
        nextStageEmphasis: input.advice.nextStageEmphasis,
        canAutoApply: false,
        requiresUserConfirmation: true,
        status: "draft",
        actorId: input.actorId,
      },
    });

    await completePersistentCreateClaim(tx, input.command, input.claimEventId, created.id, {
      source: created.source,
      stagePlanId: created.stagePlanId,
      aiStatus: input.advice.status,
      externalCall: input.externalCall,
      canAutoApply: false,
      requiresUserConfirmation: true,
      context: {
        rangeKind: input.context.rangeKind,
        rangeDays: input.context.rangeDays,
        effectiveMinutes: input.context.effectiveMinutes,
        taskCompletionRate: input.context.taskCompletionRate,
        reviewCompletionRate: input.context.reviewCompletionRate,
        lowConversionCount: input.context.lowConversionCount,
        subjectCount: input.context.subjectShares.length,
        weakNodeSubjectCount: input.context.weakNodeSummary.length,
        hasSimulationSummary: Boolean(input.context.simulationSummary),
        riskTags: input.context.riskTags,
      },
    }, { ai: input.ai });

    return created;
  });

  return serializeStageAdjustmentDraft(draft);
}

async function replayAiStageAdjustmentDraft(
  replay: PersistentCreateReplay,
  workspaceId: string,
): Promise<AiStageAdjustmentDraftResult> {
  const draft = await prisma.stageAdjustmentDraft.findFirst({
    where: { id: replay.resultId, workspaceId },
  });
  if (!draft) throw new ApiError("AI_STAGE_ADJUSTMENT_DRAFT_IDEMPOTENCY_RESULT_UNAVAILABLE", 409);
  const snapshot = asRecord(replay.resultSnapshot);
  const ai = asRecord(snapshot.ai);
  if (
    typeof ai.status !== "string" ||
    typeof ai.externalCall !== "boolean" ||
    typeof ai.fallbackToLocalRule !== "boolean" ||
    typeof ai.reason !== "string"
  ) {
    throw new ApiError("AI_STAGE_ADJUSTMENT_DRAFT_IDEMPOTENCY_SNAPSHOT_UNAVAILABLE", 409);
  }
  return {
    draft: serializeStageAdjustmentDraft(draft),
    ai: {
      status: ai.status as AiAdviceStatus,
      externalCall: ai.externalCall,
      fallbackToLocalRule: ai.fallbackToLocalRule,
      reason: ai.reason,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function resolveStagePlan(stagePlanId: string | null | undefined, workspaceId: string): Promise<{
  id: string;
  goal: string;
  mode: StageAdjustmentContext["stagePlanMode"];
  status: StageAdjustmentContext["stagePlanStatus"];
  endDate: Date;
} | null> {
  if (stagePlanId) {
    const plan = await prisma.stagePlan.findFirst({
      where: { id: stagePlanId, workspaceId },
      select: { id: true, goal: true, mode: true, status: true, endDate: true },
    });
    if (!plan) throw new ApiError("STAGE_PLAN_NOT_FOUND", 404);
    return normalizeStagePlan(plan);
  }

  const plan = await prisma.stagePlan.findFirst({
    where: { workspaceId, status: { in: ["active", "draft"] } },
    orderBy: [{ status: "asc" }, { startDate: "asc" }, { createdAt: "desc" }],
    select: { id: true, goal: true, mode: true, status: true, endDate: true },
  });

  return plan ? normalizeStagePlan(plan) : null;
}

function normalizeStagePlan(plan: {
  id: string;
  goal: string;
  mode: string;
  status: string;
  endDate: Date;
}): {
  id: string;
  goal: string;
  mode: StageAdjustmentContext["stagePlanMode"];
  status: StageAdjustmentContext["stagePlanStatus"];
  endDate: Date;
} {
  return {
    id: plan.id,
    goal: plan.goal,
    mode: plan.mode as StageAdjustmentContext["stagePlanMode"],
    status: plan.status as StageAdjustmentContext["stagePlanStatus"],
    endDate: plan.endDate,
  };
}

async function getLatestSimulationSummary(workspaceId: string): Promise<StageAdjustmentContext["simulationSummary"]> {
  const exam = await prisma.simulationExam.findFirst({
    where: {
      workspaceId,
      OR: [
        { actualScore: { not: null } },
        { actualDurationMinutes: { not: null } },
        { blankQuestionCount: { gt: 0 } },
      ],
      subjectResults: { some: {} },
    },
    include: {
      subjectResults: {
        select: { id: true },
      },
    },
    orderBy: [{ examDate: "desc" }, { updatedAt: "desc" }],
  });
  if (!exam) return null;

  return {
    examDate: exam.examDate.toISOString(),
    scoreRate: exam.actualScore != null && exam.targetScore != null && exam.targetScore > 0
      ? exam.actualScore / exam.targetScore
      : null,
    durationRate: exam.actualDurationMinutes != null && exam.targetDurationMinutes != null && exam.targetDurationMinutes > 0
      ? exam.actualDurationMinutes / exam.targetDurationMinutes
      : null,
    blankQuestionCount: exam.blankQuestionCount,
    subjectCount: exam.subjectResults.length,
  };
}

async function summarizeWeakNodes(now: Date, workspaceId: string): Promise<StageAdjustmentContext["weakNodeSummary"]> {
  const staleBefore = new Date(now.getTime() - staleEvidenceDays * dayMs);
  const nodes = await prisma.syllabusNode.findMany({
    where: {
      status: { in: ["WEAK", "NEEDS_REVIEW"] },
      subject: { workspaceId },
    },
    select: {
      status: true,
      updatedAt: true,
      subject: {
        select: { name: true },
      },
    },
    take: 200,
  });
  const bySubject = new Map<string, {
    subjectName: string;
    weakCount: number;
    reviewCount: number;
    staleEvidenceCount: number;
  }>();

  for (const node of nodes) {
    const current = bySubject.get(node.subject.name) ?? {
      subjectName: node.subject.name,
      weakCount: 0,
      reviewCount: 0,
      staleEvidenceCount: 0,
    };
    if (node.status === "WEAK") current.weakCount += 1;
    if (node.status === "NEEDS_REVIEW") current.reviewCount += 1;
    if (node.updatedAt < staleBefore) current.staleEvidenceCount += 1;
    bySubject.set(node.subject.name, current);
  }

  return [...bySubject.values()].sort((left, right) =>
    (right.weakCount + right.reviewCount + right.staleEvidenceCount) -
    (left.weakCount + left.reviewCount + left.staleEvidenceCount),
  ).slice(0, 8);
}

function createRiskTags(
  analytics: Awaited<ReturnType<typeof getAnalyticsSummary>>,
  latestExam: StageAdjustmentContext["simulationSummary"],
  stagePlan: Awaited<ReturnType<typeof resolveStagePlan>>,
  now: Date,
): string[] {
  const tags = new Set<string>();
  if (analytics.totals.weeklyTaskCompletionRate < 0.35) tags.add("low_completion");
  if (analytics.totals.lowConversionCount > 0) tags.add("low_conversion");
  if (analytics.totals.reviewCompletionRate < 0.5) tags.add("review_gap");
  if ((latestExam?.scoreRate ?? 1) < 0.55) tags.add("simulation_gap");
  if (stagePlan && daysUntil(stagePlan.endDate, now) <= 45) tags.add("sprint");
  if (tags.size === 0) tags.add("steady");
  return [...tags];
}

function summarizeStageGoal(goal: string): string {
  const normalized = goal.replace(/\s+/g, " ").trim();
  if (normalized.length <= stageGoalSummaryMaxLength) return normalized;
  return `${normalized.slice(0, stageGoalSummaryMaxLength)}...`;
}

function serializeStageAdjustmentDraft(draft: {
  id: string;
  revision: number;
  stagePlanId: string | null;
  sourceReportDecisionId?: string | null;
  sourceReportRevision?: number | null;
  originVersion?: number | null;
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
    sourceReportDecisionId: draft.sourceReportDecisionId ?? null,
    sourceReportRevision: draft.sourceReportRevision ?? null,
    originVersion: draft.originVersion ?? null,
    source: draft.source as StageAdjustmentDraftRecordDto["source"],
    mode: draft.mode as StageAdjustmentDraftRecordDto["mode"],
    risk: draft.risk as StageAdjustmentDraftRecordDto["risk"],
    riskConclusion: draft.riskConclusion,
    focusSubjects: parseStringArray(draft.focusSubjects),
    taskIntensity: draft.taskIntensity as StageAdjustmentDraftRecordDto["taskIntensity"],
    taskAdjustmentActions: parseStringArray(draft.taskAdjustmentActions) as StageAdjustmentDraftRecordDto["taskAdjustmentActions"],
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
