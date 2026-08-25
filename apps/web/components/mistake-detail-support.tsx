import type { MistakeCauseDto, MistakeDto } from "@/lib/contracts";
import { isoToShanghaiDateInput, shiftShanghaiDateInput } from "@/lib/formatters";

export interface MistakeDetailClientProps {
  userId: string;
  mistake: MistakeDto;
  readOnly: boolean;
  subjectArchived: boolean;
  workspaceName: string;
  noteOptions: Array<{ id: string; title: string }>;
  resourceOptions: Array<{ id: string; title: string }>;
  returnTo?: string;
  renderedAt: string;
}

export interface MistakeAnswerDraft {
  answerMode: "TEXT" | "PAPER_OR_ORAL";
  answerText: string;
  paperOrOralCompleted: boolean;
  revealed: boolean;
  result: "PASSED" | "PARTIAL" | "FAILED";
  note: string;
}

export interface MistakeEditDraft {
  baseUpdatedAt: string;
  title: string;
  questionText: string;
  source: string;
  cause: MistakeCauseDto;
  causeNote: string;
  correctAnswer: string;
  correctIdea: string;
}

export interface MistakeScheduleDraft {
  reviewDate: string;
}

export interface MistakeConflict {
  latest: MistakeDto;
  conflictFields: string[];
  operation: "edit" | "archive" | "restore";
}

export interface ReviewScheduleResponse {
  schedule?: NonNullable<MistakeDto["reviewSchedule"]>;
  error?: string;
}

export const causeOptions: Array<[MistakeCauseDto, string]> = [
  ["unknown", "未分类"],
  ["concept_confusion", "概念混淆"],
  ["formula_unfamiliar", "公式不熟"],
  ["wrong_approach", "方法错误"],
  ["careless", "粗心"],
  ["time_pressure", "时间压力"],
  ["unfamiliar_pattern", "题型陌生"],
];

export function toEditDraft(mistake: MistakeDto): MistakeEditDraft {
  return {
    baseUpdatedAt: mistake.updatedAt,
    title: mistake.title,
    questionText: mistake.questionText ?? "",
    source: mistake.source ?? "",
    cause: mistake.cause,
    causeNote: mistake.causeNote ?? "",
    correctAnswer: mistake.correctAnswer ?? "",
    correctIdea: mistake.correctIdea ?? "",
  };
}

export function editDraftsEqual(left: MistakeEditDraft, right: MistakeEditDraft) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isCompleteMistake(
  mistake: Pick<MistakeDto, "questionText" | "cause" | "correctIdea">,
) {
  return Boolean(mistake.questionText?.trim())
    && mistake.cause !== "unknown"
    && Boolean(mistake.correctIdea?.trim());
}

export function isAnswerDraft(value: unknown): value is MistakeAnswerDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<MistakeAnswerDraft>;
  return (draft.answerMode === "TEXT" || draft.answerMode === "PAPER_OR_ORAL")
    && typeof draft.answerText === "string"
    && typeof draft.paperOrOralCompleted === "boolean"
    && typeof draft.revealed === "boolean"
    && (draft.result === "PASSED" || draft.result === "PARTIAL" || draft.result === "FAILED")
    && typeof draft.note === "string";
}

export function isEditDraft(value: unknown): value is MistakeEditDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<MistakeEditDraft>;
  return [
    draft.baseUpdatedAt,
    draft.title,
    draft.questionText,
    draft.source,
    draft.causeNote,
    draft.correctAnswer,
    draft.correctIdea,
  ].every((field) => typeof field === "string")
    && causeOptions.some(([cause]) => cause === draft.cause);
}

export function isScheduleDraft(value: unknown): value is MistakeScheduleDraft {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as Partial<MistakeScheduleDraft>).reviewDate === "string",
  );
}

export function isMistakeDto(value: unknown): value is MistakeDto {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<MistakeDto>;
  return typeof row.id === "string"
    && typeof row.updatedAt === "string"
    && typeof row.title === "string"
    && Array.isArray(row.reviewHistory);
}

export function toMistakeReviewSchedule(schedule: NonNullable<MistakeDto["reviewSchedule"]>) {
  return schedule;
}

export function toDateInput(value: string | null) {
  if (!value) return "";
  try {
    return isoToShanghaiDateInput(value);
  } catch {
    return "";
  }
}

export function labelCause(cause: MistakeCauseDto) {
  return causeOptions.find(([value]) => value === cause)?.[1] ?? cause;
}

export function labelResult(result: "PASSED" | "PARTIAL" | "FAILED") {
  return result === "PASSED" ? "通过" : result === "PARTIAL" ? "部分掌握" : "未通过";
}

export function addStudyDays(days: number) {
  return shiftShanghaiDateInput(isoToShanghaiDateInput(new Date()), days);
}

export function MistakeTrendSummary({ mistake }: { mistake: MistakeDto }) {
  const recent = mistake.attempts.slice(0, 5);
  const passed = recent.filter((attempt) => attempt.result === "PASSED").length;
  const failed = recent.filter((attempt) => attempt.result === "FAILED").length;
  const rate = recent.length ? Math.round((passed / recent.length) * 100) : 0;
  const latest = recent[0];
  return (
    <div className="af-metric-grid-four grid gap-2">
      <TrendMetric label="最近通过率" value={`${rate}%`} />
      <TrendMetric label="连续通过" value={`${mistake.reviewSchedule?.consecutivePassCount ?? 0} 次`} />
      <TrendMetric label="最近失败" value={`${failed} 次`} />
      <TrendMetric label="最近结果" value={latest ? labelResult(latest.result) : "暂无"} />
    </div>
  );
}

function TrendMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-[#101419] px-3 py-2">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-zinc-100">{value}</p>
    </div>
  );
}

export function conflictComparisons(
  local: MistakeEditDraft,
  baseline: MistakeDto,
  latest?: MistakeDto,
) {
  return [
    { field: "updatedAt", label: "更新时间", baseline: baseline.updatedAt, local: local.baseUpdatedAt, server: latest?.updatedAt },
    { field: "archivedAt", label: "归档状态", local: baseline.archivedAt, server: latest?.archivedAt },
    { field: "title", label: "题面", local: local.title, server: latest?.title },
    { field: "source", label: "来源", local: local.source || null, server: latest?.source },
    { field: "cause", label: "错因", local: local.cause, server: latest?.cause },
    { field: "correctIdea", label: "正确思路", local: local.correctIdea, server: latest?.correctIdea },
  ];
}
