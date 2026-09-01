import type { ConflictComparison } from "@/components/conflict-resolution-modal";
import type { PlanInboxItemDto } from "@/lib/contracts";
import { formatDateKey, isoToShanghaiDateInput } from "@/lib/formatters";
import { withReturnTo } from "@/lib/navigation/app-navigation";

export type DependencyType = "SOFT" | "HARD";

export interface PlanInboxFormDraft {
  title: string;
  subjectId: string;
  plannedDate: string;
  estimatedMinutes: string;
  priority: string;
  type: string;
  planMilestoneId: string;
  primaryNodeId: string;
  relatedNodeIds: string[];
  predecessors: Array<{ taskId: string; dependencyType: DependencyType }>;
}

export interface PlanInboxConflict {
  latest: PlanInboxItemDto;
  conflictFields: string[];
  firstSubmissionSnapshot: PlanInboxFormDraft | null;
}

export interface PendingPlanInboxConvert {
  idempotencyKey: string;
  expectedRevision: number;
  submittedSnapshot: PlanInboxFormDraft;
  resultState: "unknown";
}

export interface PlanInboxStoredDraft {
  version: 2;
  fields: PlanInboxFormDraft;
  baseRevision: number;
  dirty: boolean;
  firstSubmissionSnapshot: PlanInboxFormDraft | null;
  pendingConvert: PendingPlanInboxConvert | null;
}

function dateInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return isoToShanghaiDateInput(date);
}

export function toPlanInboxFormDraft(item: PlanInboxItemDto): PlanInboxFormDraft {
  return {
    title: item.title,
    subjectId: item.subjectId ?? "",
    plannedDate: dateInput(item.plannedDate),
    estimatedMinutes: item.estimatedMinutes?.toString() ?? "",
    priority: item.priority?.toUpperCase() ?? "MEDIUM",
    type: item.type ?? "focus",
    planMilestoneId: item.planMilestoneId ?? "",
    primaryNodeId: item.primaryNodeId ?? "",
    relatedNodeIds: item.relatedNodeIds,
    predecessors: item.dependencyRefs
      .filter((ref) => ref.targetType === "TASK" && ref.taskId)
      .map((ref) => ({ taskId: ref.taskId as string, dependencyType: ref.dependencyType })),
  };
}

export function planInboxStatusLabel(status: PlanInboxItemDto["status"]): string {
  if (status === "OPEN") return "待补全";
  if (status === "CONVERTED") return "已转为任务";
  return "已忽略";
}

export function shanghaiDateOffset(days: number): string {
  return formatDateKey(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
}

export function buildPlanInboxConflictComparisons(
  local: PlanInboxFormDraft,
  baseRevision: number,
  localItem: PlanInboxItemDto,
  conflict: PlanInboxConflict,
  pendingConvert: PendingPlanInboxConvert | null,
): ConflictComparison[] {
  const server = toPlanInboxFormDraft(conflict.latest);
  const baseline = conflict.firstSubmissionSnapshot;
  const fields: Array<{ field: string; key: keyof PlanInboxFormDraft; label: string }> = [
    { field: "title", key: "title", label: "标题" },
    { field: "subjectId", key: "subjectId", label: "科目" },
    { field: "plannedDate", key: "plannedDate", label: "计划日期" },
    { field: "estimatedMinutes", key: "estimatedMinutes", label: "预计时长" },
    { field: "priority", key: "priority", label: "优先级" },
    { field: "type", key: "type", label: "类型" },
    { field: "planMilestoneId", key: "planMilestoneId", label: "里程碑" },
    { field: "primaryNodeId", key: "primaryNodeId", label: "主考纲节点" },
    { field: "relatedNodeIds", key: "relatedNodeIds", label: "相关考纲节点" },
    { field: "predecessorTasks", key: "predecessors", label: "前置依赖" },
  ];
  return [
    {
      field: "revision",
      label: "Inbox revision",
      ...(baseline ? { baseline: baseRevision } : {}),
      local: baseRevision,
      server: conflict.latest.revision,
    },
    {
      field: "status",
      label: "状态",
      local: localItem.status,
      server: conflict.latest.status,
    },
    ...fields.map(({ field, key, label }) => ({
      field,
      label,
      ...(baseline ? { baseline: baseline[key] } : {}),
      local: local[key],
      server: server[key],
    })),
    {
      field: "convertedTaskId",
      label: "转换结果任务",
      local: localItem.convertedTaskId,
      server: conflict.latest.convertedTaskId,
    },
    {
      field: "idempotencyKey",
      label: "本地转换命令身份",
      local: pendingConvert?.idempotencyKey ?? "未挂起",
      server: "服务端审计结果",
    },
  ];
}

function isPlanInboxFormDraft(value: unknown): value is PlanInboxFormDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<PlanInboxFormDraft>;
  return [draft.title, draft.subjectId, draft.plannedDate, draft.estimatedMinutes, draft.priority, draft.type, draft.planMilestoneId, draft.primaryNodeId]
    .every((field) => typeof field === "string")
    && Array.isArray(draft.relatedNodeIds)
    && draft.relatedNodeIds.every((id) => typeof id === "string")
    && Array.isArray(draft.predecessors)
    && draft.predecessors.every((entry) => entry && typeof entry.taskId === "string" && (entry.dependencyType === "SOFT" || entry.dependencyType === "HARD"));
}

export function isPlanInboxStoredDraftValue(value: unknown): value is PlanInboxStoredDraft | PlanInboxFormDraft {
  if (isPlanInboxFormDraft(value)) return true;
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<PlanInboxStoredDraft>;
  return draft.version === 2
    && isPlanInboxFormDraft(draft.fields)
    && typeof draft.baseRevision === "number"
    && Number.isInteger(draft.baseRevision)
    && draft.baseRevision > 0
    && typeof draft.dirty === "boolean"
    && (draft.firstSubmissionSnapshot === null || isPlanInboxFormDraft(draft.firstSubmissionSnapshot))
    && (draft.pendingConvert === null || isPendingPlanInboxConvert(draft.pendingConvert));
}

function isPendingPlanInboxConvert(value: unknown): value is PendingPlanInboxConvert {
  if (!value || typeof value !== "object") return false;
  const command = value as Partial<PendingPlanInboxConvert>;
  return typeof command.idempotencyKey === "string"
    && command.idempotencyKey.length >= 8
    && typeof command.expectedRevision === "number"
    && Number.isInteger(command.expectedRevision)
    && command.expectedRevision > 0
    && isPlanInboxFormDraft(command.submittedSnapshot)
    && command.resultState === "unknown";
}

export function legacyPlanInboxStoredDraft(
  fields: PlanInboxFormDraft,
  baseRevision: number,
): PlanInboxStoredDraft {
  return {
    version: 2,
    fields,
    baseRevision,
    dirty: true,
    firstSubmissionSnapshot: null,
    pendingConvert: null,
  };
}

export function planInboxDraftsEqual(left: PlanInboxFormDraft, right: PlanInboxFormDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createPlanInboxConvertKey(itemId: string): string {
  const identity = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `plan-inbox-convert-${itemId}-${identity}`;
}

export function isPlanInboxItemDto(value: unknown): value is PlanInboxItemDto {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PlanInboxItemDto>;
  return typeof item.id === "string"
    && typeof item.workspaceId === "string"
    && typeof item.originKey === "string"
    && typeof item.originVersion === "number"
    && (item.status === "OPEN" || item.status === "DISMISSED" || item.status === "CONVERTED")
    && typeof item.revision === "number"
    && Array.isArray(item.relatedNodeIds)
    && Array.isArray(item.dependencyRefs);
}

export function detailHref(itemId: string, returnTo: string): string {
  return withReturnTo(`/roadmap/allocation/drafts/${itemId}`, returnTo);
}

export function withInboxStatus(
  returnTo: string,
  status: "OPEN" | "DISMISSED" | "CONVERTED",
): string {
  try {
    const url = new URL(returnTo, "https://areaforge.invalid");
    if (url.pathname !== "/roadmap/allocation/drafts") return `/roadmap/allocation/drafts?status=${status}`;
    url.searchParams.set("status", status);
    return `${url.pathname}?${url.searchParams.toString()}`;
  } catch {
    return `/roadmap/allocation/drafts?status=${status}`;
  }
}
