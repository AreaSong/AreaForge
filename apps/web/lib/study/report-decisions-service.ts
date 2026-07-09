import { prisma, type Prisma, type PrismaClient } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import {
  getPeriodicReport,
  serializePeriodicReportDecision,
  type PeriodicReportDecisionDto,
  type PeriodicReportKind,
} from "./reports-service";

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
  const report = await getPeriodicReport(input.kind, now);
  assertCurrentReportRange(input, report.range);

  const status = input.action === "confirm" ? "confirmed" : "rejected";
  const nextCycleDraft = input.action === "confirm" ? report.decisionPreview.nextCycleDraft : null;

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.periodicReportDecision.findUnique({
      where: {
        kind_rangeStart_rangeEnd: {
          kind: report.kind,
          rangeStart: new Date(report.range.start),
          rangeEnd: new Date(report.range.end),
        },
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
      },
    });

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
  });

  return {
    ...serializePeriodicReportDecision(result.decision),
    alreadyDecided: result.alreadyDecided,
  };
}

export async function listPeriodicReportDecisions(kind?: PeriodicReportKind): Promise<PeriodicReportDecisionDto[]> {
  const decisions = await prisma.periodicReportDecision.findMany({
    where: kind ? { kind } : undefined,
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
