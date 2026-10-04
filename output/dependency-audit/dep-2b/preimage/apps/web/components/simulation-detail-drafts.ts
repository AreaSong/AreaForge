import type {
  SimulationExamDto,
  SimulationLossItemDto,
  SimulationLossReasonDto,
  SimulationRemediationDto,
  SyllabusOptionNodeDto,
} from "@/lib/contracts";

export interface SimulationValidationDetails {
  formErrors?: string[];
  fieldErrors?: Record<string, string[]>;
}

export const simulationLossReasons: Array<{ value: SimulationLossReasonDto; label: string }> = [
  ["CONCEPT_GAP", "概念缺口"], ["MEMORY_FORMULA", "记忆/公式"], ["METHOD_ERROR", "方法错误"],
  ["CALCULATION_CARELESS", "计算/粗心"], ["TIME_ALLOCATION", "时间分配"], ["READING_COMPREHENSION", "审题理解"],
  ["UNFAMILIAR_PATTERN", "题型陌生"], ["MINDSET", "心态"], ["UNANSWERED", "未作答"], ["OTHER", "其他"],
].map(([value, label]) => ({ value: value as SimulationLossReasonDto, label }));

export interface SimulationLossItemDraft {
  clientKey: string;
  id: string | null;
  revision: number | null;
  archivedAt: string | null;
  mistakeId: string | null;
  dirty: boolean;
  reason: SimulationLossReasonDto;
  syllabusNodeId: string | null;
  lostScore: number;
  note: string;
}

export interface SubjectDraft {
  subjectId: string;
  subjectResultId: string | null;
  expectedRevision?: number;
  paperFullScore: number | null;
  targetScore: number | null;
  actualScore: number | null;
  durationMinutes: number | null;
  blankQuestionCount: number;
  summary: string;
  lossItems: SimulationLossItemDraft[];
}

export interface SimulationEditorDraft {
  schemaVersion: 3;
  baseRevision: number;
  summary: string;
  mindset: string;
  reviewText: string;
  subjectDrafts: SubjectDraft[];
}

export type LossItemAction = "save" | "archive" | "restore";

export interface LossItemConflict {
  subjectId: string;
  clientKey: string;
  action: LossItemAction;
  latest: SimulationLossItemDto;
  conflictFields: string[];
}

export function flattenNodes(nodes: SyllabusOptionNodeDto[]): SyllabusOptionNodeDto[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
}

export function hasPersistedSubjectResults(exam: SimulationExamDto): boolean {
  return exam.totalsSource === "subject_sum" && exam.subjectResults.length > 0;
}

export function initialSimulationSubjectIds(exam: SimulationExamDto, subjects: Array<{ id: string }>): string[] {
  const persisted = exam.subjectResults.map((result) => result.subjectId).filter((id) => subjects.some((subject) => subject.id === id));
  return (persisted.length > 0 ? persisted : subjects.slice(0, 1).map((subject) => subject.id)).slice(0, 8);
}

export function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

export function isReadyForConfirmation(exam: SimulationExamDto): boolean {
  return exam.status !== "CONFIRMED"
    && hasPersistedSubjectResults(exam)
    && exam.subjectResults.every((result) => result.actualScore != null)
    && Boolean(exam.summary?.trim())
    && Boolean(exam.reviewText?.trim())
    && Boolean(exam.mindset?.trim());
}

export function buildSubjectDrafts(exam: SimulationExamDto, subjects: Array<{ id: string }>): SubjectDraft[] {
  return subjects.map((subject) => {
    const existing = exam.subjectResults.find((result) => result.subjectId === subject.id);
    return {
      subjectId: subject.id,
      subjectResultId: existing?.id ?? null,
      expectedRevision: existing?.revision,
      paperFullScore: existing?.paperFullScore ?? null,
      targetScore: existing?.targetScore ?? null,
      actualScore: existing?.actualScore ?? null,
      durationMinutes: existing?.durationMinutes ?? null,
      blankQuestionCount: existing?.blankQuestionCount ?? 0,
      summary: existing?.summary ?? "",
      lossItems: existing?.lossItems.map(toLossItemDraft) ?? [],
    };
  });
}

export function toSimulationEditorDraft(exam: SimulationExamDto, subjects: Array<{ id: string }>): SimulationEditorDraft {
  return buildEditorDraft(exam.revision, exam.summary ?? "", exam.mindset ?? "", exam.reviewText ?? "", buildSubjectDrafts(exam, subjects));
}

export function buildEditorDraft(
  baseRevision: number,
  summary: string,
  mindset: string,
  reviewText: string,
  subjectDrafts: SubjectDraft[],
): SimulationEditorDraft {
  return { schemaVersion: 3, baseRevision, summary, mindset, reviewText, subjectDrafts };
}

export function editorDraftsEqual(left: SimulationEditorDraft, right: SimulationEditorDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isSimulationEditorDraft(value: unknown): value is SimulationEditorDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<SimulationEditorDraft>;
  const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion;
  return (schemaVersion === 2 || schemaVersion === 3)
    && typeof draft.baseRevision === "number"
    && typeof draft.summary === "string"
    && typeof draft.mindset === "string"
    && Array.isArray(draft.subjectDrafts)
    && draft.subjectDrafts.every(isSubjectDraft);
}

function isSubjectDraft(value: unknown): value is SubjectDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<SubjectDraft>;
  return typeof draft.subjectId === "string"
    && (draft.subjectResultId === null || typeof draft.subjectResultId === "string")
    && (draft.expectedRevision === undefined || typeof draft.expectedRevision === "number")
    && isNullableNumber(draft.paperFullScore)
    && isNullableNumber(draft.targetScore)
    && isNullableNumber(draft.actualScore)
    && isNullableNumber(draft.durationMinutes)
    && typeof draft.blankQuestionCount === "number"
    && typeof draft.summary === "string"
    && Array.isArray(draft.lossItems)
    && draft.lossItems.every(isSimulationLossItemDraft);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isSimulationLossItemDraft(value: unknown): value is SimulationLossItemDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<SimulationLossItemDraft>;
  return typeof item.clientKey === "string"
    && (item.id === null || typeof item.id === "string")
    && (item.revision === null || typeof item.revision === "number")
    && (item.archivedAt === null || typeof item.archivedAt === "string")
    && (item.mistakeId === undefined || item.mistakeId === null || typeof item.mistakeId === "string")
    && typeof item.dirty === "boolean"
    && simulationLossReasons.some((reason) => reason.value === item.reason)
    && (item.syllabusNodeId === null || typeof item.syllabusNodeId === "string")
    && typeof item.lostScore === "number"
    && typeof item.note === "string";
}

export function toSubjectResultPayload(draft: SubjectDraft) {
  return {
    subjectId: draft.subjectId,
    expectedRevision: draft.expectedRevision,
    paperFullScore: draft.paperFullScore,
    targetScore: draft.targetScore,
    actualScore: draft.actualScore,
    durationMinutes: draft.durationMinutes,
    blankQuestionCount: draft.blankQuestionCount,
    lossReasons: [],
    summary: draft.summary,
    ...(draft.subjectResultId ? {} : {
      lossItems: draft.lossItems.filter((item) => !item.archivedAt).map((item) => ({
        reason: item.reason,
        syllabusNodeId: item.syllabusNodeId,
        lostScore: item.lostScore,
        note: item.note || null,
      })),
    }),
  };
}

export function hasPendingPersistedLossEdits(drafts: SubjectDraft[]): boolean {
  return drafts.some((draft) => Boolean(draft.subjectResultId)
    && draft.lossItems.some((item) => !item.id || item.dirty));
}

export function toLossItemDraft(item: SimulationLossItemDto): SimulationLossItemDraft {
  return {
    clientKey: item.id,
    id: item.id,
    revision: item.revision,
    archivedAt: item.archivedAt,
    mistakeId: item.mistakeId,
    dirty: false,
    reason: item.reason,
    syllabusNodeId: item.syllabusNodeId,
    lostScore: item.lostScore,
    note: item.note ?? "",
  };
}

export function replaceLossConflictItem(
  drafts: SubjectDraft[],
  conflict: LossItemConflict,
  preserveIntent: boolean,
): SubjectDraft[] {
  return drafts.map((draft) => draft.subjectId !== conflict.subjectId ? draft : {
    ...draft,
    lossItems: draft.lossItems.map((item) => {
      if (item.clientKey !== conflict.clientKey) return item;
      const latest = { ...toLossItemDraft(conflict.latest), clientKey: item.clientKey };
      if (!preserveIntent || conflict.action !== "save") return latest;
      return {
        ...item,
        id: conflict.latest.id,
        revision: conflict.latest.revision,
        archivedAt: conflict.latest.archivedAt,
        dirty: true,
      };
    }),
  });
}

export function isSimulationLossItemDto(value: unknown): value is SimulationLossItemDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<SimulationLossItemDto>;
  return typeof item.id === "string"
    && typeof item.revision === "number"
    && typeof item.reason === "string"
    && typeof item.lostScore === "number"
    && (item.archivedAt === null || typeof item.archivedAt === "string");
}

export function lossMutationNotice(action: "create" | LossItemAction): string {
  if (action === "create") return "失分条目已创建，稳定 ID 与父版本已更新。";
  if (action === "archive") return "失分条目已归档，可在当前分科中恢复。";
  if (action === "restore") return "失分条目已恢复。";
  return "失分条目已保存。";
}

export function remediationInboxStatusLabel(status: NonNullable<SimulationRemediationDto["inboxStatus"]>): string {
  if (status === "CONVERTED") return "已转任务";
  if (status === "DISMISSED") return "已忽略";
  return "已入收件箱";
}

export function labelLossItemError(error: string | undefined): string {
  if (error === "SIMULATION_LOSS_ITEM_REVISION_CONFLICT") return "失分条目已在其他页面更新；当前意图仍保留，请人工处理差异。";
  if (error === "SIMULATION_EXAM_REVISION_CONFLICT" || error === "SIMULATION_SUBJECT_REVISION_CONFLICT") return "考试或分科已在其他页面更新；失分操作未执行，请先处理父版本差异。";
  if (error === "SIMULATION_EXAM_CONFIRMED") return "这场模拟已确认，失分条目已只读。";
  if (error === "SIMULATION_REVIEW_REQUIRED") return "请先保存整场复盘，再确认模拟考试。";
  if (error === "SIMULATION_ACTUAL_SCORES_REQUIRED") return "请先填写所有已选科目的实际分，再确认模拟考试。";
  if (error === "SUBJECT_ARCHIVED") return "相关科目已归档，失分操作未执行。";
  return error ?? "失分操作失败，当前输入仍保留。";
}

export function isSimulationExamDto(value: unknown): value is SimulationExamDto {
  if (!value || typeof value !== "object") return false;
  const exam = value as Partial<SimulationExamDto>;
  return typeof exam.id === "string"
    && typeof exam.revision === "number"
    && (exam.status === "DRAFT" || exam.status === "IN_PROGRESS" || exam.status === "CONFIRMED")
    && Array.isArray(exam.subjectResults);
}

export function labelSaveError(
  error: string | undefined,
  fallback: string,
  details?: SimulationValidationDetails,
): string {
  if (error === "SIMULATION_EXAM_REVISION_CONFLICT" || error === "SIMULATION_SUBJECT_REVISION_CONFLICT") return "其他页面已更新这场模拟；当前输入已保留，请先处理差异再显式提交。";
  if (error === "SIMULATION_EXAM_CONFIRMED") return "这场模拟已在服务端确认；当前本地草稿不会覆盖只读结果。";
  if (error === "SUBJECT_ARCHIVED") return "相关科目已归档；当前输入已保留，请先处理服务端最新状态。";
  if (error === "INVALID_REQUEST" && details) {
    const fields = Object.entries(details.fieldErrors ?? {})
      .flatMap(([field, messages]) => messages.map((message) => `${field}: ${message}`));
    const formErrors = details.formErrors ?? [];
    const reason = [...fields, ...formErrors].join("；");
    if (reason) return `输入校验未通过：${reason}`;
  }
  return error ?? `${fallback}；当前输入已保留。`;
}
