import assert from "node:assert/strict";
import test from "node:test";
import { Children, isValidElement, type ReactNode } from "react";
import { StageOverviewContent } from "@/lib/routes/plan-stages-page";
import { StagePlanCreateForm } from "@/components/stage-plan-create-form";
import type { StagePlanDto } from "@/lib/contracts";

function walk(node: ReactNode): Array<{ type: unknown; props: Record<string, unknown> }> {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    return [{ type: child.type, props: child.props }, ...walk(child.props.children)];
  });
}

function plan(status: StagePlanDto["status"]): StagePlanDto {
  return { id: status, status, revision: 1, name: `${status}阶段`, goal: "阶段目标", mode: "maintain",
    startDate: "2026-01-01T00:00:00Z", endDate: "2026-01-31T00:00:00Z", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
}

test("空阶段和仅历史阶段都提供创建表单，历史仍可见", () => {
  for (const plans of [[], [plan("completed"), plan("archived")]]) {
    const nodes = walk(StageOverviewContent({ plans, drafts: [], milestones: [], latestDecision: null, query: {} }));
    assert.equal(nodes.filter((node) => node.type === StagePlanCreateForm).length, 1);
    assert.equal(nodes.some((node) => node.props.href === "#create-stage-plan"), true);
    if (plans.length) assert.equal(nodes.some((node) => node.props["aria-label"] === "历史阶段"), true);
  }
});

test("已有 active 或 draft 时保留当前阶段，历史不能代替当前阶段", () => {
  for (const status of ["active", "draft"] as const) {
    const current = plan(status);
    const nodes = walk(StageOverviewContent({ plans: [plan("completed"), current], drafts: [], milestones: [], latestDecision: null, query: {} }));
    assert.equal(nodes.some((node) => node.type === StagePlanCreateForm), false);
    assert.equal(nodes.some((node) => node.props.plan === current), true);
  }
});
