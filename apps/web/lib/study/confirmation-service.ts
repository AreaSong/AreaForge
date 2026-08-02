import { prisma } from "@areaforge/db";
import { getPeriodicReport } from "./reports-service";
import { listSimulationExams } from "./simulation-service";
import { listStageAdjustmentDrafts } from "./stage-service";
import { listKnowledgeRetests } from "./knowledge-retest-service";
import { resolveActiveWorkspace } from "./exam-workspace-service";

export type ConfirmationFilter = "pending" | "history";
export type ConfirmationKind = "periodic_report" | "stage_adjustment" | "simulation" | "knowledge_retest" | "ai_draft";
export type ConfirmationStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "FROZEN";

export interface ConfirmationItemDto {
  id: string;
  kind: ConfirmationKind;
  sourceId: string;
  revision: number;
  status: ConfirmationStatus;
  requiresUserConfirmation: boolean;
  confirmedAt: string | null;
  frozenAt: string | null;
  title: string;
  summary: string;
  href: string;
  sourceLabel: string;
  createdAt: string;
  /** @deprecated Consumers should derive this from status/frozenAt. */
  frozen: boolean;
}

export async function listConfirmationItems(actorId: string, filter: ConfirmationFilter): Promise<ConfirmationItemDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const [week, month, stageDrafts, simulations, retests, aiOperations] = await Promise.all([
    getPeriodicReport("week", new Date(), actorId),
    getPeriodicReport("month", new Date(), actorId),
    listStageAdjustmentDrafts(actorId),
    listSimulationExams(actorId),
    listKnowledgeRetests(actorId),
    prisma.aiDraftOperation.findMany({
      where: { actorId, workspaceId: workspace.id, status: "SUCCEEDED" },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { operationId: true, endpoint: true, createdAt: true, consumedAt: true, revision: true },
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
    return confirmationItem({
      id: decision?.id ?? `report-${report.kind}-${report.range.end}`,
      sourceId: decision?.id ?? `report:${report.kind}:${report.range.end}`,
      kind: "periodic_report",
      revision: report.revision,
      status,
      requiresUserConfirmation: true,
      confirmedAt: decision?.status === "confirmed" ? decision.decidedAt : null,
      frozenAt,
      title: `${report.kind === "week" ? "周" : "月"}期报告：${report.weakness.title}`,
      summary: report.strategy.mustPressIssue,
      href: `/review/reports?period=${report.kind}`,
      sourceLabel: "周期报告",
      createdAt: report.range.end,
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
      href: "/plan/stages#pending-stage-draft",
      sourceLabel: draft.source === "ai" ? "AI 阶段建议" : "规则阶段建议",
      createdAt: draft.createdAt,
    });
  });

  const simulationItems = simulations.map((exam): ConfirmationItemDto => {
    const status = exam.status === "DRAFT" ? "PENDING" : "FROZEN";
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
      summary: exam.status === "DRAFT" ? "完成评分、失分分析、个人反馈和复盘后再确认。" : exam.reviewText ?? "已确认的模拟考试记录。",
      href: `/test/simulations/${exam.id}`,
      sourceLabel: "模拟考试",
      createdAt: exam.updatedAt,
    });
  });

  const retestItems = retests.map((retest): ConfirmationItemDto => {
    const status = retest.status === "CLOSED" ? "FROZEN" : retest.status === "VOIDED" ? "REJECTED" : "PENDING";
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
      href: `/test/retests/${retest.id}`,
      sourceLabel: "专项复测",
      createdAt: retest.testedAt ?? retest.scheduledAt ?? new Date().toISOString(),
    });
  });

  const aiItems = aiOperations.map((operation): ConfirmationItemDto => {
    const status = operation.consumedAt ? "CONFIRMED" : "PENDING";
    return confirmationItem({
      id: operation.operationId,
      sourceId: operation.operationId,
      kind: "ai_draft",
      revision: operation.revision,
      status,
      requiresUserConfirmation: true,
      confirmedAt: operation.consumedAt?.toISOString() ?? null,
      frozenAt: operation.consumedAt?.toISOString() ?? null,
      title: `AI 草稿：${aiEndpointLabel(operation.endpoint)}`,
      summary: operation.consumedAt ? "草稿结果已采用，可回到原页面查看当时输入。" : "AI 只生成建议，不会直接修改记录；请回到原页面采用或放弃。",
      href: aiEndpointHref(operation.endpoint),
      sourceLabel: "AI 建议",
      createdAt: operation.createdAt.toISOString(),
    });
  });

  return [...reportItems, ...stageItems, ...simulationItems, ...retestItems, ...aiItems]
    .filter((item) => filter === "pending" ? item.status === "PENDING" : item.status !== "PENDING")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
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
    "knowledge-card": "/knowledge/notes",
    plan: "/plan",
    motivation: "/settings/profile",
  } as Record<string, string>)[endpoint] ?? "/confirmations";
}
