import { prisma, type Prisma, type PrismaClient } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import {
  getPeriodicReport,
  getPeriodicReportDecisionContext,
  serializePeriodicReportDecision,
  type PeriodicReportDecisionDto,
  type PeriodicReportDto,
  type PeriodicReportKind,
} from "./reports-service";
import { resolveActiveWorkspace } from "./exam-workspace-service";
import { createPlanInboxItemWithResult, type PlanInboxWriteResult } from "./plan-inbox-service";
import type { PlanInboxWriteSummaryDto } from "./types";

type ReportDecisionClient = PrismaClient | Prisma.TransactionClient;

const reportWorkbench = "/roadmap/reviews";

export interface ReportDecisionConflictLatest {
  kind: "periodic-report-decision";
  report: PeriodicReportDto;
  decision: PeriodicReportDecisionDto | null;
  sourceConflict?: unknown;
}

export type PeriodicReportDecisionAction = "confirm" | "reject";

export interface DecidePeriodicReportInput {
  kind: PeriodicReportKind;
  action: PeriodicReportDecisionAction;
  expectedRevision: number;
  rangeStart: string;
  rangeEnd: string;
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

export async function decidePeriodicReport(
  input: DecidePeriodicReportInput,
  actorId: string,
  now = new Date(),
): Promise<PeriodicReportDecisionDto> {
  const report = await getPeriodicReport(input.kind, now, actorId);
  assertCurrentReportRange(input, report);
  if (input.expectedRevision !== report.revision) {
    throw new ApiError("PERIODIC_REPORT_REVISION_CONFLICT", 409, {
      latest: reportConflictLatest(report),
      conflictFields: ["revision"],
      workbench: reportWorkbench,
    });
  }
  const workspace = await resolveActiveWorkspace(actorId);

  const status = input.action === "confirm" ? "confirmed" : "rejected";
  const nextCycleDraft = input.action === "confirm" ? report.decisionPreview.nextCycleDraft : null;

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.periodicReportDecision.findFirst({
      where: {
        kind: report.kind,
        rangeStart: new Date(report.range.start),
        rangeEnd: new Date(report.range.end),
        workspaceId: workspace.id,
      },
    });

    if (existing) {
      if (existing.status === status) {
        const stageDraft = await tx.stageAdjustmentDraft.findFirst({ where: { sourceReportDecisionId: existing.id, workspaceId: workspace.id }, select: { id: true } });
        return {
          decision: existing,
          alreadyDecided: true,
          stageDraftId: stageDraft?.id ?? null,
          inboxResult: emptyInboxResult(),
        };
      }
      throw new ApiError("PERIODIC_REPORT_DECISION_CONFLICT", 409, {
        latest: reportConflictLatest(report, serializePeriodicReportDecision(existing)),
        conflictFields: ["decision.status"],
        workbench: reportWorkbench,
      });
    }

    const created = await tx.periodicReportDecision.create({
      data: {
        kind: report.kind,
        rangeStart: new Date(report.range.start),
        rangeEnd: new Date(report.range.end),
        status,
        reportSnapshot: report.decisionPreview.snapshot as unknown as Prisma.InputJsonValue,
        nextCycleDraft: nextCycleDraft ? (nextCycleDraft as unknown as Prisma.InputJsonValue) : undefined,
        canAutoApply: false,
        requiresUserConfirmation: true,
        actorId,
        workspaceId: workspace.id,
      },
    });

    const inboxWrites: PlanInboxWriteResult[] = [];
    let stageDraftId: string | null = null;
    if (input.action === "confirm") {
      for (const [index, action] of report.decisionPreview.nextCycleDraft.actions.entries()) {
        const originKey = `report:${report.kind}:${report.range.start}:${index}`;
        inboxWrites.push(await createPlanInboxItemWithResult(tx, workspace.id, actorId, {
          stableKey: `${created.id}:action:${index}`,
          originKey,
          originVersion: report.revision,
          originType: "PERIODIC_REPORT",
          originSnapshot: { decisionId: created.id, kind: report.kind, action, range: report.range, sourceReportRevision: report.revision },
          title: action,
          estimatedMinutes: 30,
          priority: report.weakness.severity === "critical" ? "critical" : "high",
          type: "review",
        }));
      }
      const stagePlan = await tx.stagePlan.findFirst({
        where: { workspaceId: workspace.id, status: { in: ["active", "draft"] } },
        orderBy: [{ status: "asc" }, { startDate: "asc" }],
      });
      const stageDraft = await tx.stageAdjustmentDraft.create({
        data: {
          workspaceId: workspace.id,
          stagePlanId: stagePlan?.id ?? null,
          sourceReportDecisionId: created.id,
          sourceReportRevision: report.revision,
          originVersion: report.revision + 1,
          source: "local_rule",
          mode: report.strategy.theme === "strengthening" ? "strengthen" : report.strategy.theme === "steady" ? "maintain" : report.strategy.theme,
          risk: report.weakness.severity === "clear" ? "low" : report.weakness.severity,
          riskConclusion: report.weakness.detail,
          focusSubjects: report.weakness.subjectName ? [report.weakness.subjectName] : [],
          taskIntensity: report.strategy.theme === "recovery" ? "reduce" : report.strategy.theme === "sprint" ? "sprint" : "keep",
          taskAdjustmentActions: report.decisionPreview.nextCycleDraft.actions as unknown as Prisma.InputJsonValue,
          nextStageEmphasis: report.strategy.stageAdjustment,
          canAutoApply: false,
          requiresUserConfirmation: true,
          status: "draft",
          actorId,
        },
      });
      stageDraftId = stageDraft.id;
    } else {
      await tx.stageAdjustmentDraft.updateMany({
        where: { workspaceId: workspace.id, sourceReportDecisionId: created.id, status: "draft" },
        data: { status: "rejected", revision: { increment: 1 }, actorId },
      });
    }

    await audit(
      tx,
      actorId,
      status === "confirmed" ? "PERIODIC_REPORT_DECISION_CONFIRMED" : "PERIODIC_REPORT_DECISION_REJECTED",
      created.id,
      {
        kind: created.kind,
        rangeStart: created.rangeStart.toISOString(),
        rangeEnd: created.rangeEnd.toISOString(),
        status: created.status,
        weaknessSource: report.weakness.source,
        weaknessSeverity: report.weakness.severity,
        strategyTheme: report.strategy.theme,
        canAutoApply: false,
        requiresUserConfirmation: true,
        boundary: "report_decision_only_no_task_or_stage_mutation",
      },
    );

    return {
      decision: created,
      alreadyDecided: false,
      stageDraftId,
      inboxResult: summarizeInboxWrites(inboxWrites),
    };
  }).catch(async (error: unknown) => {
    if (isUniqueViolation(error)) {
      const existing = await prisma.periodicReportDecision.findFirst({
        where: {
          kind: report.kind,
          rangeStart: new Date(report.range.start),
          rangeEnd: new Date(report.range.end),
          workspaceId: workspace.id,
        },
      });
      if (!existing || existing.status !== status) {
        throw new ApiError("PERIODIC_REPORT_DECISION_CONFLICT", 409, {
          latest: reportConflictLatest(report, existing ? serializePeriodicReportDecision(existing) : report.decision),
          conflictFields: ["decision.status"],
          workbench: reportWorkbench,
        });
      }
      const stageDraft = await prisma.stageAdjustmentDraft.findFirst({ where: { sourceReportDecisionId: existing.id, workspaceId: workspace.id }, select: { id: true } });
      return { decision: existing, alreadyDecided: true, stageDraftId: stageDraft?.id ?? null, inboxResult: emptyInboxResult() };
    }
    if (error instanceof ApiError && error.status === 409) {
      throw enrichReportConflict(error, report);
    }
    throw error;
  });

  return {
    ...serializePeriodicReportDecision(result.decision),
    alreadyDecided: result.alreadyDecided,
    stageDraftId: result.stageDraftId,
    inboxResult: result.inboxResult,
  };
}

export async function listPeriodicReportDecisions(kind?: PeriodicReportKind, actorId?: string): Promise<PeriodicReportDecisionDto[]> {
  const workspace = actorId ? await resolveActiveWorkspace(actorId) : null;
  const decisions = await prisma.periodicReportDecision.findMany({
    where: { ...(kind ? { kind } : {}), ...(workspace ? { workspaceId: workspace.id } : {}) },
    orderBy: [{ decidedAt: "desc" }],
    take: 50,
  });

  return Promise.all(decisions.map(async (decision) => {
    const context = workspace
      ? await getPeriodicReportDecisionContext(decision.id, workspace.id, decision.kind as PeriodicReportKind, decision.rangeStart)
      : null;
    return serializePeriodicReportDecision(decision, context ?? undefined);
  }));
}

export async function getPeriodicReportDecision(id: string, actorId: string): Promise<PeriodicReportDecisionDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const decision = await prisma.periodicReportDecision.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!decision) throw new ApiError("PERIODIC_REPORT_DECISION_NOT_FOUND", 404);
  const context = await getPeriodicReportDecisionContext(
    decision.id,
    workspace.id,
    decision.kind as PeriodicReportKind,
    decision.rangeStart,
  );
  return serializePeriodicReportDecision(decision, context);
}

function assertCurrentReportRange(
  input: DecidePeriodicReportInput,
  report: PeriodicReportDto,
): void {
  if (
    new Date(input.rangeStart).getTime() !== new Date(report.range.start).getTime() ||
    new Date(input.rangeEnd).getTime() !== new Date(report.range.end).getTime()
  ) {
    throw new ApiError("PERIODIC_REPORT_RANGE_STALE", 409, {
      latest: reportConflictLatest(report),
      conflictFields: ["range.start", "range.end"],
      workbench: reportWorkbench,
    });
  }
}

function reportConflictLatest(
  report: PeriodicReportDto,
  decision: PeriodicReportDecisionDto | null = report.decision,
  sourceConflict?: unknown,
): ReportDecisionConflictLatest {
  return {
    kind: "periodic-report-decision",
    report,
    decision,
    ...(sourceConflict === undefined ? {} : { sourceConflict }),
  };
}

function enrichReportConflict(error: ApiError, report: PeriodicReportDto): ApiError {
  const latest = isReportDecisionConflictLatest(error.details?.latest)
    ? error.details.latest
    : reportConflictLatest(report, report.decision, error.details?.latest);
  return new ApiError(error.code, 409, {
    latest,
    conflictFields: error.details?.conflictFields?.length ? error.details.conflictFields : ["decision"],
    workbench: reportWorkbench,
  });
}

function isReportDecisionConflictLatest(value: unknown): value is ReportDecisionConflictLatest {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (value as { kind?: unknown }).kind === "periodic-report-decision");
}

async function audit(
  client: ReportDecisionClient,
  actorId: string,
  action: string,
  entityId: string,
  metadata: Prisma.InputJsonObject,
): Promise<void> {
  await client.auditEvent.create({
    data: {
      actorId,
      action,
      entityType: "PeriodicReportDecision",
      entityId,
      metadata,
    },
  });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
