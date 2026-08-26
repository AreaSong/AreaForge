import type { PlanMilestoneConflictLatest, PlanMilestoneDto } from "@/lib/contracts";
import { isValidShanghaiDateInput, shanghaiDateInputToIso } from "@/lib/formatters";

export interface MilestoneCreatePayload {
  stagePlanId: string;
  expectedStagePlanRevision: number;
  stableKey: string;
  title: string;
  targetDate: string | null;
  sortOrder: number;
}

export interface MilestoneFormDraft {
  baseRevision: number;
  stableKey: string;
  title: string;
  targetDate: string;
  firstSubmittedPayload: MilestoneCreatePayload | null;
}

export interface MilestoneArchiveCommand {
  milestoneId: string;
  desiredArchived: boolean;
  baseRevision: number;
  firstSubmittedPayload: { expectedRevision: number; archive: boolean };
  firstSubmittedSnapshot: PlanMilestoneDto;
}

export type MilestoneConflict =
  | { type: "create"; fields: string[]; submitted: MilestoneCreatePayload; latest: PlanMilestoneConflictLatest }
  | { type: "archive"; fields: string[]; command: MilestoneArchiveCommand; latest: PlanMilestoneConflictLatest };

export function createArchiveCommand(row: PlanMilestoneDto, desiredArchived: boolean): MilestoneArchiveCommand {
  return {
    milestoneId: row.id,
    desiredArchived,
    baseRevision: row.revision,
    firstSubmittedPayload: { expectedRevision: row.revision, archive: desiredArchived },
    firstSubmittedSnapshot: row,
  };
}

export function formPayload(draft: MilestoneFormDraft, stagePlanId: string, sortOrder: number): MilestoneCreatePayload {
  return {
    stagePlanId,
    expectedStagePlanRevision: draft.baseRevision,
    stableKey: draft.stableKey.trim(),
    title: draft.title.trim(),
    targetDate: draft.targetDate ? shanghaiDateInputToIso(draft.targetDate) : null,
    sortOrder,
  };
}

export function milestoneConflictComparisons(conflict: MilestoneConflict) {
  if (conflict.type === "create") {
    return [
      { field: "stagePlan.revision", label: "StagePlan revision", local: conflict.submitted.expectedStagePlanRevision, server: conflict.latest.stagePlan?.revision ?? null },
      { field: "stableKey", label: "稳定键", local: conflict.submitted.stableKey, server: conflict.latest.milestone?.stableKey ?? null },
      { field: "title", label: "标题", local: conflict.submitted.title, server: conflict.latest.milestone?.title ?? null },
      { field: "targetDate", label: "目标日期", local: conflict.submitted.targetDate, server: conflict.latest.milestone?.targetDate ?? null },
    ];
  }
  const local = conflict.command.firstSubmittedSnapshot;
  return [
    { field: "revision", label: "里程碑 revision", local: local.revision, server: conflict.latest.milestone?.revision ?? null },
    { field: "archivedAt", label: "归档状态", local: conflict.command.desiredArchived ? "归档" : "恢复", server: conflict.latest.milestone?.archivedAt ? "归档" : "恢复" },
    { field: "title", label: "标题", local: local.title, server: conflict.latest.milestone?.title ?? null },
  ];
}

export function upsertMilestone(rows: PlanMilestoneDto[], milestone: PlanMilestoneDto): PlanMilestoneDto[] {
  return rows.some((row) => row.id === milestone.id)
    ? rows.map((row) => row.id === milestone.id ? milestone : row)
    : [...rows, milestone];
}

export function nextMilestoneKey(rows: PlanMilestoneDto[]): string {
  const used = new Set(rows.map((row) => row.stableKey));
  let suffix = rows.length + 1;
  while (used.has(`milestone-${suffix}`)) suffix += 1;
  return `milestone-${suffix}`;
}

export function isMilestoneConflictLatest(value: unknown): value is PlanMilestoneConflictLatest {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (value as { kind?: unknown }).kind === "plan-milestone");
}

export function isMilestoneFormDraft(value: unknown): value is MilestoneFormDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Partial<MilestoneFormDraft>;
  return typeof draft.baseRevision === "number"
    && typeof draft.stableKey === "string"
    && typeof draft.title === "string"
    && typeof draft.targetDate === "string"
    && (!draft.targetDate || isValidShanghaiDateInput(draft.targetDate))
    && (draft.firstSubmittedPayload === null || isMilestoneCreatePayload(draft.firstSubmittedPayload));
}

export function isMilestoneCreatePayload(value: unknown): value is MilestoneCreatePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Partial<MilestoneCreatePayload>;
  return typeof payload.stagePlanId === "string"
    && typeof payload.expectedStagePlanRevision === "number"
    && typeof payload.stableKey === "string"
    && typeof payload.title === "string"
    && (payload.targetDate === null || typeof payload.targetDate === "string")
    && typeof payload.sortOrder === "number";
}

export function isMilestoneArchiveCommand(value: unknown): value is MilestoneArchiveCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Partial<MilestoneArchiveCommand>;
  const payload = command.firstSubmittedPayload as { expectedRevision?: unknown; archive?: unknown } | undefined;
  const snapshot = command.firstSubmittedSnapshot as Partial<PlanMilestoneDto> | undefined;
  return typeof command.milestoneId === "string"
    && typeof command.desiredArchived === "boolean"
    && typeof command.baseRevision === "number"
    && typeof payload?.expectedRevision === "number"
    && typeof payload?.archive === "boolean"
    && typeof snapshot?.id === "string"
    && typeof snapshot?.revision === "number";
}

export function samePayload(left: MilestoneCreatePayload, right: MilestoneCreatePayload): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function labelMilestoneError(error?: string): string {
  if (error === "PLAN_MILESTONE_STABLE_KEY_CONFLICT") return "这个稳定键已存在，请处理冲突后修改。";
  if (error === "PLAN_MILESTONE_REVISION_CONFLICT") return "里程碑已被其他页面更新，请处理差异后重试。";
  if (error === "PLAN_MILESTONE_STAGE_PLAN_REVISION_CONFLICT") return "StagePlan 已更新，请基于最新阶段版本重新检查。";
  return error ?? "里程碑操作失败。";
}
