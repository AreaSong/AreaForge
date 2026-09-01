import type { ConflictComparison } from "@/components/conflict-resolution-modal";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
} from "@/lib/client/private-business-drafts";
import type {
  ResolveUploadRequest,
  UploadResolutionLatest,
} from "@/lib/api/uploads";
import type { StudyResourceDto, StagingUploadResult } from "@/lib/contracts";

export type UploadResolutionRequest = ResolveUploadRequest;

export type UploadItem = {
  key: string;
  file?: File;
  originalName: string;
  status: "ready" | "staging" | "duplicate" | "done" | "failed";
  staging?: StagingUploadResult;
  decision?: "reuse" | "copy" | "skip";
  reuseResourceId?: string;
  resultTitle?: string;
  error?: string;
  submittedSnapshot?: UploadResolutionRequest;
};

export type UploadResolutionConflict = {
  itemKey: string;
  submitted: UploadResolutionRequest;
  latest: UploadResolutionLatest;
  conflictFields: string[];
  workbench: string;
};

export type BatchStagingResponseItem = {
  index: number;
  originalName: string;
  staging: StagingUploadResult | null;
  error: string | null;
};

export type PendingUploadDraft = {
  key: string;
  fileName: string;
  staging: StagingUploadResult;
  decision: "reuse" | "copy" | "skip";
  reuseResourceId?: string;
  submittedSnapshot?: UploadResolutionRequest;
};

export type ResourceFormDraft = {
  mode: "files" | "link";
  subjectId: string;
  category: string;
  tags: string;
  linkTitle: string;
  linkUrl: string;
};

export const resourceCategories = [
  ["TEXTBOOK", "教材/讲义"], ["COURSE", "课程资料"], ["EXERCISE", "习题/题集"],
  ["PAST_PAPER", "真题/模拟"], ["SOLUTION", "题解/解析"], ["SUMMARY", "总结/速查"],
  ["IMAGE", "截图/图片"], ["OTHER", "其他"],
] as const;

export function statusLabel(item: UploadItem) { if (item.status === "ready") return "待上传"; if (item.status === "staging") return "检查中"; if (item.status === "duplicate") return "待重复决策"; if (item.status === "failed") return "失败"; return item.resultTitle ?? "完成"; }
export function splitTags(value: string) { return value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 20); }

export function loadPendingUploads(key: string): UploadItem[] {
  if (typeof window === "undefined") return [];
  const raw = loadPrivateBusinessDraft(key, LONG_PRIVATE_DRAFT_TTL_MS, isPendingUploadDraftArray);
  if (!raw) return [];
  return raw.slice(0, 5).flatMap((value): UploadItem[] => {
    if (!isPendingUploadDraft(value)) return [];
    return [{
      key: value.key,
      file: createRecoveryFile(value.fileName),
      originalName: value.fileName,
      status: "duplicate",
      staging: value.staging,
      decision: value.decision,
      reuseResourceId: value.reuseResourceId,
      submittedSnapshot: value.submittedSnapshot,
    }];
  });
}

export function restoreServerPendingUpload(staging: StagingUploadResult): UploadItem {
  const originalName = staging.attachment.originalName || "attachment";
  return {
    key: `attachment-${staging.attachment.id}`,
    file: createRecoveryFile(originalName),
    originalName,
    status: "duplicate",
    staging,
    decision: staging.duplicates.length ? "reuse" : "copy",
    reuseResourceId: staging.duplicates[0]?.resourceId,
  };
}

export function mergePendingUploads(current: UploadItem[], restored: UploadItem[]): UploadItem[] {
  const merged = [...current];
  for (const item of restored) {
    const attachmentId = item.staging?.attachment.id;
    if (!attachmentId || merged.some((row) => row.staging?.attachment.id === attachmentId)) continue;
    merged.push(item);
  }
  return merged.slice(0, 5);
}

export function mergeUploadItemUpdates(current: UploadItem[], updates: UploadItem[]): UploadItem[] {
  const updatesByKey = new Map(updates.map((item) => [item.key, item]));
  return current.map((item) => updatesByKey.get(item.key) ?? item);
}

export function isResourceFormDraft(value: unknown): value is ResourceFormDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<ResourceFormDraft>;
  return (draft.mode === "files" || draft.mode === "link")
    && [draft.subjectId, draft.category, draft.tags, draft.linkTitle, draft.linkUrl]
      .every((field) => typeof field === "string");
}

export function isUploadResolutionLatest(value: unknown): value is UploadResolutionLatest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UploadResolutionLatest>;
  return typeof candidate.attachmentId === "string" &&
    (candidate.decision === "reuse" || candidate.decision === "copy" || candidate.decision === "skip") &&
    (candidate.resourceId === null || typeof candidate.resourceId === "string") &&
    (candidate.resource === null || isStudyResourceDto(candidate.resource)) &&
    (candidate.request === null || isUploadResolutionRequest(candidate.request));
}

export function safeResourceWorkbench(value: unknown): string {
  return value === "/knowledge/resources" ? value : "/knowledge/resources";
}

export function uploadResolutionComparisons(
  conflict: UploadResolutionConflict,
  local: UploadResolutionRequest,
): ConflictComparison[] {
  const server = conflict.latest.request;
  return [
    { field: "decision", label: "处理决策", baseline: conflict.submitted.decision, local: local.decision, server: server?.decision ?? conflict.latest.decision },
    { field: "reuseResourceId", label: "复用目标", baseline: conflict.submitted.reuseResourceId, local: local.reuseResourceId, server: server?.reuseResourceId ?? conflict.latest.resourceId },
    { field: "title", label: "资料标题", baseline: conflict.submitted.title, local: local.title, server: server?.title },
    { field: "subjectId", label: "科目", baseline: conflict.submitted.subjectId, local: local.subjectId, server: server?.subjectId },
    { field: "category", label: "资料类型", baseline: conflict.submitted.category, local: local.category, server: server?.category },
    { field: "tags", label: "标签", baseline: conflict.submitted.tags, local: local.tags, server: server?.tags },
  ];
}

function createRecoveryFile(name: string): File {
  if (typeof File !== "undefined") return new File([], name);
  return { name } as File;
}

function isPendingUploadDraft(value: unknown): value is PendingUploadDraft {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PendingUploadDraft>;
  const staging = candidate.staging;
  return typeof candidate.key === "string" && typeof candidate.fileName === "string" &&
    (candidate.decision === "reuse" || candidate.decision === "copy" || candidate.decision === "skip") &&
    (candidate.submittedSnapshot === undefined || isUploadResolutionRequest(candidate.submittedSnapshot)) &&
    Boolean(staging && typeof staging === "object" && staging.attachment && typeof staging.attachment.id === "string" && Array.isArray(staging.duplicates));
}

function isPendingUploadDraftArray(value: unknown): value is PendingUploadDraft[] {
  return Array.isArray(value) && value.every(isPendingUploadDraft);
}

function isUploadResolutionRequest(value: unknown): value is UploadResolutionRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UploadResolutionRequest>;
  return typeof candidate.attachmentId === "string" &&
    (candidate.decision === "reuse" || candidate.decision === "copy" || candidate.decision === "skip") &&
    (candidate.reuseResourceId === undefined || typeof candidate.reuseResourceId === "string") &&
    typeof candidate.title === "string" &&
    (candidate.subjectId === null || typeof candidate.subjectId === "string") &&
    typeof candidate.category === "string" &&
    Array.isArray(candidate.tags) && candidate.tags.every((tag) => typeof tag === "string");
}

export function isStudyResourceDto(value: unknown): value is StudyResourceDto {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StudyResourceDto>;
  return typeof candidate.id === "string" && typeof candidate.revision === "number" && typeof candidate.title === "string";
}
