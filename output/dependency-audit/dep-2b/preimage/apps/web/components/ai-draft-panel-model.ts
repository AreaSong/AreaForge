import { AI_ADVICE_STATUSES } from "@areaforge/core";
import { publishAiDraftHandoff } from "@/lib/client/ai-draft-handoff";
import type {
  AiDraftEndpointDto,
  AiDraftGenerateRequestDto,
  AiDraftPreviewRequestDto,
  AiDraftScopeDto,
  AiDraftToneDto,
  AiAdviceStatus,
  KnowledgeCardDraftAdvice,
  LearningTreeDraftAdvice,
  MotivationDraftAdvice,
  PlanDraftAdvice,
} from "@/lib/contracts";
import { isValidShanghaiDateRangeInput } from "@/lib/formatters";

export type AiDraftEndpoint = AiDraftEndpointDto;
export type AiDraftTone = AiDraftToneDto;
export type AiDraftScope = AiDraftScopeDto;
export type ProjectionKey =
  | "subjectLabel"
  | "rootNodeLabel"
  | "nodeLabel"
  | "milestoneLabel"
  | "dateWindow"
  | "defaultDurationMinutes";

export const projectionFields = {
  "learning-tree": [
    { key: "subjectLabel", label: "科目名称" },
    { key: "rootNodeLabel", label: "根节点名称" },
  ],
  "knowledge-card": [
    { key: "subjectLabel", label: "科目名称" },
    { key: "nodeLabel", label: "考纲节点名称" },
  ],
  plan: [
    { key: "subjectLabel", label: "科目名称" },
    { key: "milestoneLabel", label: "里程碑名称" },
    { key: "dateWindow", label: "日期范围" },
    { key: "defaultDurationMinutes", label: "默认时长" },
  ],
  motivation: [],
} satisfies Record<AiDraftEndpoint, Array<{ key: ProjectionKey; label: string }>>;

export const noteKinds = ["GENERAL", "CONCEPT", "METHOD", "EXAMPLE", "JOURNAL", "SUMMARY"] as const;
export type AiDraftNoteKind = (typeof noteKinds)[number];

export interface ProjectionValues {
  subjectLabel: string;
  rootNodeLabel: string;
  nodeLabel: string;
  milestoneLabel: string;
  dateStart: string;
  dateEnd: string;
  defaultDurationMinutes: string;
}

export interface AiFormDraft {
  contextKey?: string;
  selectedText: string;
  tone: AiDraftTone;
  scope: AiDraftScope;
  kind: AiDraftNoteKind;
  checked: Partial<Record<ProjectionKey, boolean>>;
  values: ProjectionValues;
  generatedDraft: unknown;
  operation: { id: string; projectionVersion: string; resultProof: string } | null;
}

export interface AiDraftRequestInput {
  endpoint: AiDraftEndpoint;
  selectedText: string;
  tone: AiDraftTone;
  scope: AiDraftScope;
  kind: AiDraftNoteKind;
  checked: AiFormDraft["checked"];
  values: ProjectionValues;
}

export type AnyAiDraftPreviewRequest = {
  [Endpoint in AiDraftEndpoint]: AiDraftPreviewRequestDto<Endpoint>;
}[AiDraftEndpoint];

export type AnyAiDraftGenerateRequest = {
  [Endpoint in AiDraftEndpoint]: AiDraftGenerateRequestDto<Endpoint>;
}[AiDraftEndpoint];

export const emptyProjectionValues: ProjectionValues = {
  subjectLabel: "",
  rootNodeLabel: "",
  nodeLabel: "",
  milestoneLabel: "",
  dateStart: "",
  dateEnd: "",
  defaultDurationMinutes: "",
};

export function adoptDraftLabel(endpoint: AiDraftEndpoint): string {
  return ({
    "learning-tree": "送往学习树校验",
    "knowledge-card": "转到知识卡片表单",
    plan: "加入投入草稿",
    motivation: "保存到动机内容库",
  })[endpoint];
}

export function hasDraftWork(input: {
  selectedText: string;
  tone: AiDraftTone;
  scope: AiDraftScope;
  kind: AiDraftNoteKind;
  checked: AiFormDraft["checked"];
  values: ProjectionValues;
  preview: Record<string, unknown> | null;
  token: string | null;
  draft: unknown;
  operation: AiFormDraft["operation"];
}): boolean {
  return Boolean(
    input.selectedText.trim()
    || input.tone !== "CALM"
    || input.scope !== "global"
    || input.kind !== "GENERAL"
    || Object.values(input.checked).some(Boolean)
    || Object.values(input.values).some((value) => value.trim())
    || input.preview
    || input.token
    || input.draft
    || input.operation,
  );
}

export function saveLocalAiDraft(
  userId: string,
  endpoint: "learning-tree" | "knowledge-card",
  value: unknown,
) {
  publishAiDraftHandoff({ endpoint, userId, value });
}

export function isLearningTreeDraft(
  value: unknown,
): value is LearningTreeDraftAdvice {
  return isRecord(value)
    && isAiAdviceStatus(value.status)
    && value.schemaVersion === "learning-tree-draft-v1"
    && isBoundedText(value.markdownDraft, 32_000)
    && Array.isArray(value.notes)
    && value.notes.length <= 5
    && value.notes.every((note) => isBoundedText(note, 300))
    && isBoundedText(value.reason, 800);
}

export function isKnowledgeCardDraft(
  value: unknown,
): value is KnowledgeCardDraftAdvice {
  return isRecord(value)
    && isAiAdviceStatus(value.status)
    && value.schemaVersion === "knowledge-card-draft-v1"
    && isBoundedText(value.title, 160)
    && isBoundedText(value.body, 12_000)
    && noteKinds.includes(value.kindHint as AiDraftNoteKind)
    && isBoundedText(value.reason, 800);
}

export function isPlanDraft(
  value: unknown,
): value is PlanDraftAdvice {
  return isRecord(value)
    && isAiAdviceStatus(value.status)
    && value.schemaVersion === "plan-draft-v1"
    && isBoundedText(value.title, 160)
    && Array.isArray(value.tasks)
    && value.tasks.length >= 1
    && value.tasks.length <= 8
    && value.tasks.every((task) => isRecord(task)
      && isBoundedText(task.title, 160)
      && typeof task.estimatedMinutes === "number"
      && Number.isInteger(task.estimatedMinutes)
      && task.estimatedMinutes >= 5
      && task.estimatedMinutes <= 480)
    && isBoundedText(value.reason, 800);
}

export function isMotivationDraft(
  value: unknown,
): value is MotivationDraftAdvice {
  return isRecord(value)
    && isAiAdviceStatus(value.status)
    && value.schemaVersion === "motivation-draft-v1"
    && isBoundedText(value.line, 500)
    && isBoundedText(value.recoveryHint, 300)
    && isBoundedText(value.reason, 800);
}

export type AiDraftAdoption =
  | { kind: "learning-tree"; draft: LearningTreeDraftAdvice }
  | { kind: "knowledge-card"; draft: KnowledgeCardDraftAdvice }
  | { kind: "plan"; draft: PlanDraftAdvice }
  | { kind: "motivation"; draft: MotivationDraftAdvice };

export function resolveAiDraftAdoption(
  endpoint: AiDraftEndpoint,
  draft: unknown,
): AiDraftAdoption | null {
  switch (endpoint) {
    case "learning-tree":
      return isLearningTreeDraft(draft) ? { kind: endpoint, draft } : null;
    case "knowledge-card":
      return isKnowledgeCardDraft(draft) ? { kind: endpoint, draft } : null;
    case "plan":
      return isPlanDraft(draft) ? { kind: endpoint, draft } : null;
    case "motivation":
      return isMotivationDraft(draft) ? { kind: endpoint, draft } : null;
  }
}

export function checkedProjectionIsComplete(
  endpoint: AiDraftEndpoint,
  checked: AiFormDraft["checked"],
  values: ProjectionValues,
): boolean {
  return projectionFields[endpoint].every(({ key }) => {
    if (!checked[key]) return true;
    if (key === "dateWindow") {
      return isValidShanghaiDateRangeInput(values.dateStart, values.dateEnd);
    }
    if (key === "defaultDurationMinutes") {
      const duration = Number(values.defaultDurationMinutes);
      return Number.isInteger(duration) && duration >= 5 && duration <= 480;
    }
    return Boolean(values[key].trim());
  });
}

export function buildAiDraftPreviewRequest(
  input: AiDraftRequestInput,
): AnyAiDraftPreviewRequest {
  switch (input.endpoint) {
    case "learning-tree":
      return {
        phase: "preview",
        selectedText: input.selectedText,
        scope: input.scope,
        checkedProjection: buildLearningTreeProjection(input.checked, input.values),
      };
    case "knowledge-card":
      return {
        phase: "preview",
        selectedText: input.selectedText,
        kind: input.kind,
        checkedProjection: buildKnowledgeCardProjection(input.checked, input.values),
      };
    case "plan":
      return {
        phase: "preview",
        selectedText: input.selectedText,
        checkedProjection: buildPlanProjection(input.checked, input.values),
      };
    case "motivation":
      return {
        phase: "preview",
        selectedText: input.selectedText,
        tone: input.tone,
      };
  }
}

export function buildAiDraftGenerateRequest(
  input: AiDraftRequestInput,
  previewToken: string,
): AnyAiDraftGenerateRequest {
  switch (input.endpoint) {
    case "learning-tree":
      return {
        phase: "generate",
        previewToken,
        selectedText: input.selectedText,
        scope: input.scope,
        checkedProjection: buildLearningTreeProjection(input.checked, input.values),
      };
    case "knowledge-card":
      return {
        phase: "generate",
        previewToken,
        selectedText: input.selectedText,
        kind: input.kind,
        checkedProjection: buildKnowledgeCardProjection(input.checked, input.values),
      };
    case "plan":
      return {
        phase: "generate",
        previewToken,
        selectedText: input.selectedText,
        checkedProjection: buildPlanProjection(input.checked, input.values),
      };
    case "motivation":
      return {
        phase: "generate",
        previewToken,
        selectedText: input.selectedText,
        tone: input.tone,
      };
  }
}

function buildLearningTreeProjection(
  checked: AiFormDraft["checked"],
  values: ProjectionValues,
): NonNullable<AiDraftPreviewRequestDto<"learning-tree">["checkedProjection"]> {
  return {
    ...(checked.subjectLabel ? { subjectLabel: values.subjectLabel.trim() } : {}),
    ...(checked.rootNodeLabel ? { rootNodeLabel: values.rootNodeLabel.trim() } : {}),
  };
}

function buildKnowledgeCardProjection(
  checked: AiFormDraft["checked"],
  values: ProjectionValues,
): NonNullable<AiDraftPreviewRequestDto<"knowledge-card">["checkedProjection"]> {
  return {
    ...(checked.subjectLabel ? { subjectLabel: values.subjectLabel.trim() } : {}),
    ...(checked.nodeLabel ? { nodeLabel: values.nodeLabel.trim() } : {}),
  };
}

function buildPlanProjection(
  checked: AiFormDraft["checked"],
  values: ProjectionValues,
): NonNullable<AiDraftPreviewRequestDto<"plan">["checkedProjection"]> {
  const projection: NonNullable<AiDraftPreviewRequestDto<"plan">["checkedProjection"]> = {
    ...(checked.subjectLabel ? { subjectLabel: values.subjectLabel.trim() } : {}),
    ...(checked.milestoneLabel ? { milestoneLabel: values.milestoneLabel.trim() } : {}),
  };
  if (checked.dateWindow) {
    if (!isValidShanghaiDateRangeInput(values.dateStart, values.dateEnd)) {
      throw new RangeError("INVALID_SHANGHAI_DATE_RANGE");
    }
    projection.dateWindow = { start: values.dateStart, end: values.dateEnd };
  }
  if (checked.defaultDurationMinutes) {
    projection.defaultDurationMinutes = Number(values.defaultDurationMinutes);
  }
  return projection;
}

export function isAiFormDraft(value: unknown): value is AiFormDraft {
  if (!isRecord(value) || typeof value.selectedText !== "string") return false;
  if (value.contextKey !== undefined && (
    typeof value.contextKey !== "string"
    || value.contextKey.length === 0
    || value.contextKey.length > 20_000
  )) return false;
  if (!["CALM", "DIRECT", "BRIEF"].includes(String(value.tone))) return false;
  if (!["global", "subject", "branch"].includes(String(value.scope))) return false;
  if (!noteKinds.includes(value.kind as AiDraftNoteKind)) return false;
  if (!isCheckedProjection(value.checked) || !isProjectionValues(value.values)) return false;
  if (value.generatedDraft !== null && !isAiGeneratedDraft(value.generatedDraft)) return false;
  if (value.operation !== null && (
    !isRecord(value.operation)
    || !isNonEmptyString(value.operation.id)
    || !isNonEmptyString(value.operation.projectionVersion)
    || typeof value.operation.resultProof !== "string"
    || !value.operation.resultProof
  )) return false;
  if ((value.generatedDraft === null) !== (value.operation === null)) return false;
  return true;
}

export function isAiFormDraftForContext(
  value: unknown,
  contextKey: string,
): value is AiFormDraft {
  return isAiFormDraft(value) && value.contextKey === contextKey;
}

function isCheckedProjection(value: unknown): value is AiFormDraft["checked"] {
  if (!isRecord(value)) return false;
  const allowed = new Set<ProjectionKey>([
    "subjectLabel",
    "rootNodeLabel",
    "nodeLabel",
    "milestoneLabel",
    "dateWindow",
    "defaultDurationMinutes",
  ]);
  return Object.entries(value).every(([key, checked]) =>
    allowed.has(key as ProjectionKey) && typeof checked === "boolean");
}

function isAiGeneratedDraft(value: unknown): boolean {
  return isLearningTreeDraft(value)
    || isKnowledgeCardDraft(value)
    || isPlanDraft(value)
    || isMotivationDraft(value);
}

function isAiAdviceStatus(value: unknown): value is AiAdviceStatus {
  return (AI_ADVICE_STATUSES as readonly unknown[]).includes(value);
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= maxLength;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isProjectionValues(value: unknown): value is ProjectionValues {
  if (!isRecord(value)) return false;
  return [
    "subjectLabel",
    "rootNodeLabel",
    "nodeLabel",
    "milestoneLabel",
    "dateStart",
    "dateEnd",
    "defaultDurationMinutes",
  ].every((key) => typeof value[key] === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readAiDraftError(
  payload: { error?: unknown } | null,
  fallback: string,
): string {
  return typeof payload?.error === "string" ? payload.error : fallback;
}
