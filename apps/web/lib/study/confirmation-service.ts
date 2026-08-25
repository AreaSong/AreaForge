import { prisma } from "@areaforge/db";
import {
  confirmationDetailRoute,
  knowledgeRetestDetailRoute,
  simulationExamDetailRoute,
} from "@/lib/navigation/route-helpers";
import { getPeriodicReport } from "./reports-service";
import { listSimulationExams } from "./simulation-service";
import { listStageAdjustmentDrafts } from "./stage-service";
import { listKnowledgeRetests } from "./knowledge-retest-service";
import { resolveActiveWorkspace } from "./exam-workspace-service";
import {
  aiConfirmationCapability,
  isSimulationReadyForConfirmation,
  periodicReportConfirmationId,
  retestConfirmationActionReady,
  retestConfirmationStatus,
  simulationConfirmationActionReady,
} from "./confirmation-rules";
import type {
  ConfirmationFilter,
  ConfirmationItemDto,
} from "@/lib/contracts/confirmation";

export type {
  ConfirmationActionDto,
  ConfirmationFilter,
  ConfirmationItemDto,
  ConfirmationKind,
  ConfirmationStatus,
} from "@/lib/contracts/confirmation";

export async function listConfirmationItems(actorId: string, filter: ConfirmationFilter): Promise<ConfirmationItemDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const [week, month, stageDrafts, simulations, retests, aiOperations] = await Promise.all([
    getPeriodicReport("week", new Date(), actorId),
    getPeriodicReport("month", new Date(), actorId),
    listStageAdjustmentDrafts(actorId),
    listSimulationExams(actorId),
    listKnowledgeRetests(actorId),
    prisma.aiDraftOperation.findMany({
      where: { actorId, workspaceId: workspace.id, status: { in: ["SUCCEEDED", "REJECTED"] } },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        operationId: true,
        endpoint: true,
        createdAt: true,
        updatedAt: true,
        consumedAt: true,
        revision: true,
        status: true,
        resultReference: true,
      },
    }),
  ]);

  const terminalIds = [
    ...stageDrafts.filter((draft) => draft.status !== "draft").map((draft) => draft.id),
    ...retests.filter((retest) => retest.status === "CLOSED" || retest.status === "VOIDED").map((retest) => retest.id),
  ];
  const terminalEvents = terminalIds.length === 0
    ? []
    : await prisma.auditEvent.findMany({
        where: {
          actorId,
          entityId: { in: terminalIds },
          action: {
            in: [
              "STAGE_ADJUSTMENT_DRAFT_APPLIED",
              "STAGE_ADJUSTMENT_DRAFT_REJECTED",
              "KNOWLEDGE_RETEST_CONFIRMED",
              "KNOWLEDGE_RETEST_VOIDED",
            ],
          },
        },
        orderBy: { createdAt: "desc" },
        select: { entityId: true, createdAt: true },
      });
  const terminalAt = new Map<string, string>();
  for (const event of terminalEvents) {
    if (event.entityId && !terminalAt.has(event.entityId)) terminalAt.set(event.entityId, event.createdAt.toISOString());
  }

  const reportItems = [week, month].map((report): ConfirmationItemDto => {
    const decision = report.decision;
    const status = decision ? (decision.status === "confirmed" ? "CONFIRMED" : "REJECTED") : "PENDING";
    const frozenAt = decision?.decidedAt ?? null;
    const confirmationId = periodicReportConfirmationId(report.kind, report.range.end);
    return confirmationItem({
      id: confirmationId,
      sourceId: decision?.id ?? report.id,
      kind: "periodic_report",
      revision: report.revision,
      status,
      requiresUserConfirmation: true,
      confirmedAt: decision?.status === "confirmed" ? decision.decidedAt : null,
      frozenAt,
      title: `${report.kind === "week" ? "周" : "月"}期报告：${report.weakness.title}`,
      summary: report.strategy.mustPressIssue,
      href: confirmationDetailRoute(confirmationId),
      sourceHref: `/roadmap/reviews?period=${report.kind}`,
      sourceLabel: "周期报告",
      createdAt: report.range.end,
      action: {
        kind: "periodic_report",
        reportId: report.id,
        reportKind: report.kind,
        expectedRevision: report.revision,
        rangeStart: report.range.start,
        rangeEnd: report.range.end,
      },
    });
  });

  const stageItems = stageDrafts.map((draft): ConfirmationItemDto => {
    const status = draft.status === "draft" ? "PENDING" : draft.status === "applied" ? "CONFIRMED" : "REJECTED";
    const decidedAt = terminalAt.get(draft.id) ?? draft.appliedAt;
    return confirmationItem({
      id: draft.id,
      sourceId: draft.id,
      kind: "stage_adjustment",
      revision: draft.revision,
      status,
      requiresUserConfirmation: draft.requiresUserConfirmation,
      confirmedAt: status === "CONFIRMED" ? decidedAt : null,
      frozenAt: decidedAt,
      title: "阶段调整建议",
      summary: draft.riskConclusion,
      href: confirmationDetailRoute(draft.id),
      sourceHref: "/roadmap/stages#pending-stage-draft",
      sourceLabel: draft.source === "ai" ? "AI 阶段建议" : "规则阶段建议",
      createdAt: draft.createdAt,
      action: draft.status === "draft"
        ? { kind: "stage_adjustment", draftId: draft.id, expectedRevision: draft.revision }
        : null,
    });
  });

  const simulationItems = simulations.filter((exam) => isSimulationReadyForConfirmation({
    status: exam.status,
    subjectResultCount: exam.subjectResults.length,
    summary: exam.summary,
    reviewText: exam.reviewText,
    mindset: exam.mindset,
  })).map((exam): ConfirmationItemDto => {
    const status = exam.status === "CONFIRMED" ? "FROZEN" : "PENDING";
    return confirmationItem({
      id: exam.id,
      sourceId: exam.id,
      kind: "simulation",
      revision: exam.revision,
      status,
      requiresUserConfirmation: true,
      confirmedAt: exam.confirmedAt,
      frozenAt: exam.confirmedAt,
      title: `模拟考试：${exam.name}`,
      summary: exam.status === "CONFIRMED" ? exam.reviewText ?? "已确认的模拟考试记录。" : "完成评分、失分分析、个人反馈和复盘后再确认。",
      href: confirmationDetailRoute(exam.id),
      sourceHref: simulationExamDetailRoute(exam.id),
      sourceLabel: "模拟考试",
      createdAt: exam.updatedAt,
      action: exam.status !== "CONFIRMED"
        ? {
            kind: "simulation",
            examId: exam.id,
            expectedRevision: exam.revision,
            ready: simulationConfirmationActionReady({
              status: exam.status,
              subjectResultCount: exam.subjectResults.length,
              summary: exam.summary,
              reviewText: exam.reviewText,
              mindset: exam.mindset,
            }),
          }
        : null,
    });
  });

  const retestItems = retests.filter((retest) => retestConfirmationStatus(retest.status) !== null).map((retest): ConfirmationItemDto => {
    const status = retestConfirmationStatus(retest.status)!;
    const decidedAt = terminalAt.get(retest.id) ?? null;
    return confirmationItem({
      id: retest.id,
      sourceId: retest.id,
      kind: "knowledge_retest",
      revision: retest.revision,
      status,
      requiresUserConfirmation: true,
      confirmedAt: status === "FROZEN" ? decidedAt : null,
      frozenAt: decidedAt,
      title: `专项复测：${retest.title}`,
      summary: retest.status === "PENDING_REVIEW" ? "复测结果和个人复盘已写入，确认后才会更新知识点掌握状态。" : retest.summary ?? "专项复测记录。",
      href: confirmationDetailRoute(retest.id),
      sourceHref: knowledgeRetestDetailRoute(retest.id),
      sourceLabel: "专项复测",
      createdAt: retest.testedAt ?? retest.scheduledAt ?? new Date().toISOString(),
      action: retest.status === "PENDING_REVIEW"
        ? { kind: "knowledge_retest", retestId: retest.id, expectedRevision: retest.revision, ready: retestConfirmationActionReady(retest.status) }
        : null,
    });
  });

  const aiItems = aiOperations.map((operation): ConfirmationItemDto => {
    const status = operation.status === "REJECTED"
      ? "REJECTED"
      : operation.consumedAt
        ? "CONFIRMED"
        : "PENDING";
    const frozenAt = operation.status === "REJECTED"
      ? (operation.consumedAt ?? operation.updatedAt).toISOString()
      : operation.consumedAt?.toISOString() ?? null;
    return confirmationItem({
      id: operation.operationId,
      sourceId: operation.operationId,
      kind: "ai_draft",
      revision: operation.revision,
      status,
      requiresUserConfirmation: true,
      confirmedAt: operation.status === "SUCCEEDED" && operation.consumedAt
        ? operation.consumedAt.toISOString()
        : null,
      frozenAt,
      title: `AI 草稿：${aiEndpointLabel(operation.endpoint)}`,
      summary: operation.status === "REJECTED"
        ? "草稿已驳回；生成历史、原 AI 入口和生成时间仍保留。"
        : operation.consumedAt
          ? "草稿结果已采用，可回到原页面查看当时输入。"
          : "AI 只生成建议，不会直接修改记录；请回到原页面采用或放弃。",
      href: confirmationDetailRoute(operation.operationId),
      sourceHref: aiEndpointHref(operation.endpoint),
      sourceLabel: `AI 建议 · ${aiEndpointLabel(operation.endpoint)}`,
      createdAt: operation.createdAt.toISOString(),
      action: { kind: "ai_draft", endpoint: operation.endpoint, operationId: operation.operationId, ...aiConfirmationCapability() },
    });
  });

  return [...reportItems, ...stageItems, ...simulationItems, ...retestItems, ...aiItems]
    .filter((item) => filter === "pending" ? item.status === "PENDING" : item.status !== "PENDING")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export async function getConfirmationItem(actorId: string, id: string): Promise<ConfirmationItemDto | null> {
  const [pending, history] = await Promise.all([
    listConfirmationItems(actorId, "pending"),
    listConfirmationItems(actorId, "history"),
  ]);
  return [...pending, ...history].find((item) => item.id === id) ?? null;
}

export function getConfirmationSourceHref(item: ConfirmationItemDto): string {
  return item.sourceHref;
}

function confirmationItem(input: Omit<ConfirmationItemDto, "frozen">): ConfirmationItemDto {
  return { ...input, frozen: input.status === "FROZEN" || input.frozenAt !== null };
}

function aiEndpointLabel(endpoint: string): string {
  return ({
    "learning-tree": "学习树",
    "knowledge-card": "知识卡片",
    plan: "计划",
    motivation: "动机内容",
  } as Record<string, string>)[endpoint] ?? "当前页面";
}

function aiEndpointHref(endpoint: string): string {
  return ({
    "learning-tree": "/knowledge/imports",
    "knowledge-card": "/knowledge/cards",
    plan: "/roadmap/allocation",
    motivation: "/settings/profile",
  } as Record<string, string>)[endpoint] ?? "/confirmations";
}
