import { prisma, type Prisma, type PrismaClient } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import {
  getPeriodicReport,
  serializePeriodicReportDecision,
  type PeriodicReportDecisionDto,
  type PeriodicReportKind,
} from "./reports-service";
import { resolveActiveWorkspace } from "./exam-workspace-service";

type ReportDecisionClient = PrismaClient | Prisma.TransactionClient;

export type PeriodicReportDecisionAction = "confirm" | "reject";

export interface DecidePeriodicReportInput {
  kind: PeriodicReportKind;
  action: PeriodicReportDecisionAction;
  rangeStart: string;
  rangeEnd: string;
}

export async function decidePeriodicReport(
  input: DecidePeriodicReportInput,
  actorId: string,
  now = new Date(),
): Promise<PeriodicReportDecisionDto> {
  const report = await getPeriodicReport(input.kind, now, actorId);
  assertCurrentReportRange(input, report.range);
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
        return {
          decision: existing,
          alreadyDecided: true,
        };
      }
      throw new ApiError("PERIODIC_REPORT_DECISION_CONFLICT", 409);
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

    if (input.action === "confirm") {
      for (const [index, action] of report.decisionPreview.nextCycleDraft.actions.entries()) {
        const originKey = `report:${report.kind}:${report.range.start}:${index}`;
        await tx.planInboxItem.create({
          data: {
            workspaceId: workspace.id,
            stableKey: `${created.id}:action:${index}`,
            originKey,
            originVersion: 1,
            originType: "PERIODIC_REPORT",
            originSnapshot: { decisionId: created.id, kind: report.kind, action, range: report.range },
            title: action,
            estimatedMinutes: 30,
            priority: report.weakness.severity === "critical" ? "critical" : "high",
            type: "review",
            actorId,
          },
        });
      }
      const stagePlan = await tx.stagePlan.findFirst({
        where: { workspaceId: workspace.id, status: { in: ["active", "draft"] } },
        orderBy: [{ status: "asc" }, { startDate: "asc" }],
      });
      await tx.stageAdjustmentDraft.create({
        data: {
          workspaceId: workspace.id,
          stagePlanId: stagePlan?.id ?? null,
          source: "local_rule",
          mode: report.strategy.theme === "strengthening" ? "strengthen" : report.strategy.theme === "steady" ? "maintain" : report.strategy.theme,
          risk: report.weakness.severity === "clear" ? "low" : report.weakness.severity,
          riskConclusion: report.weakness.detail,
          focusSubjects: report.weakness.subjectName ? [report.weakness.subjectName] : [],
          taskIntensity: report.strategy.theme === "recovery" ? "reduce" : report.strategy.theme === "sprint" ? "sprint" : "keep",
          taskAdjustmentActions: [],
          nextStageEmphasis: report.strategy.stageAdjustment,
          canAutoApply: false,
          requiresUserConfirmation: true,
          status: "draft",
          actorId,
        },
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
    };
  }).catch(async (error: unknown) => {
    if (!isUniqueViolation(error)) throw error;
    const existing = await prisma.periodicReportDecision.findFirst({
      where: {
        kind: report.kind,
        rangeStart: new Date(report.range.start),
        rangeEnd: new Date(report.range.end),
        workspaceId: workspace.id,
      },
    });
    if (!existing || existing.status !== status) {
      throw new ApiError("PERIODIC_REPORT_DECISION_CONFLICT", 409);
    }
    return { decision: existing, alreadyDecided: true };
  });

  return {
    ...serializePeriodicReportDecision(result.decision),
    alreadyDecided: result.alreadyDecided,
  };
}

export async function listPeriodicReportDecisions(kind?: PeriodicReportKind, actorId?: string): Promise<PeriodicReportDecisionDto[]> {
  const workspace = actorId ? await resolveActiveWorkspace(actorId) : null;
  const decisions = await prisma.periodicReportDecision.findMany({
    where: { ...(kind ? { kind } : {}), ...(workspace ? { workspaceId: workspace.id } : {}) },
    orderBy: [{ decidedAt: "desc" }],
    take: 50,
  });

  return decisions.map(serializePeriodicReportDecision);
}

function assertCurrentReportRange(
  input: DecidePeriodicReportInput,
  range: { start: string; end: string },
): void {
  if (
    new Date(input.rangeStart).getTime() !== new Date(range.start).getTime() ||
    new Date(input.rangeEnd).getTime() !== new Date(range.end).getTime()
  ) {
    throw new ApiError("PERIODIC_REPORT_RANGE_STALE", 409);
  }
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
