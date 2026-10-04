import type {
  MistakeCauseDto,
  MistakeCreatePrefillDto,
  MistakeDto,
  SyllabusOptionNodeDto,
} from "@/lib/contracts";
import { Metric } from "@/components/ui/metric";
import { formatDate } from "@/lib/formatters";

export interface MistakeFormDraft {
  subjectId: string;
  syllabusNodeId: string;
  title: string;
  questionText: string;
  source: string;
  cause: MistakeCauseDto;
  causeNote: string;
  correctAnswer: string;
  correctIdea: string;
  nextReviewAt: string;
}

export interface MistakeListFilters {
  subject: string;
  node: string;
  cause: "all" | MistakeCauseDto;
  review: "all" | "due" | "scheduled" | "none";
}

export function createMistakeFormDefaults(
  prefill: MistakeCreatePrefillDto | null | undefined,
  subjectId: string,
  syllabusNodeId: string,
): MistakeFormDraft {
  return {
    subjectId: prefill?.subjectId ?? subjectId,
    syllabusNodeId: prefill?.syllabusNodeId ?? syllabusNodeId,
    title: prefill?.title ?? "",
    questionText: prefill?.questionText ?? "",
    source: prefill?.source ?? "",
    cause: prefill?.cause ?? "unknown",
    causeNote: prefill?.causeNote ?? "",
    correctAnswer: "",
    correctIdea: "",
    nextReviewAt: "",
  };
}

export interface FlatMistakeNode {
  id: string;
  subjectId: string;
  title: string;
  depth: number;
}

export function OverviewMetric({ label, value }: { label: string; value: string }) {
  return <Metric label={label} value={value} layout="compact" valueSize="lg" className="border-l border-[var(--af-border)]" />;
}

export function recentPassRate(mistakes: MistakeDto[]) {
  const attempts = mistakes.flatMap((mistake) => mistake.attempts.slice(0, 5));
  if (attempts.length === 0) return 0;
  return Math.round((attempts.filter((attempt) => attempt.result === "PASSED").length / attempts.length) * 100);
}

export function recentFailures(mistakes: MistakeDto[]) {
  return mistakes.reduce(
    (total, mistake) => total + mistake.attempts.slice(0, 5).filter((attempt) => attempt.result === "FAILED").length,
    0,
  );
}

export function CauseOptions() {
  return (
    <>
      <option value="unknown">未分类</option>
      <option value="concept_confusion">概念混淆</option>
      <option value="formula_unfamiliar">公式不熟</option>
      <option value="wrong_approach">方法错误</option>
      <option value="careless">粗心</option>
      <option value="time_pressure">时间压力</option>
      <option value="unfamiliar_pattern">题型陌生</option>
    </>
  );
}

export function isMistakeFormDraft(value: unknown): value is MistakeFormDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<MistakeFormDraft>;
  return [
    draft.subjectId,
    draft.syllabusNodeId,
    draft.title,
    draft.questionText,
    draft.source,
    draft.causeNote,
    draft.correctAnswer,
    draft.correctIdea,
    draft.nextReviewAt,
  ].every((field) => typeof field === "string")
    && [
      "unknown",
      "concept_confusion",
      "formula_unfamiliar",
      "wrong_approach",
      "careless",
      "time_pressure",
      "unfamiliar_pattern",
    ].includes(String(draft.cause));
}

export function labelResult(result: "PASSED" | "PARTIAL" | "FAILED"): string {
  return result === "PASSED" ? "通过" : result === "PARTIAL" ? "部分掌握" : "未通过";
}

export function flattenNodes(nodes: SyllabusOptionNodeDto[], depth = 0): FlatMistakeNode[] {
  return nodes.flatMap((node) => [
    {
      id: node.id,
      subjectId: node.subjectId,
      title: node.title,
      depth,
    },
    ...flattenNodes(node.children, depth + 1),
  ]);
}

export function labelCause(cause: MistakeCauseDto): string {
  switch (cause) {
    case "concept_confusion":
      return "概念混淆";
    case "formula_unfamiliar":
      return "公式不熟";
    case "wrong_approach":
      return "方法错误";
    case "careless":
      return "粗心";
    case "time_pressure":
      return "时间压力";
    case "unfamiliar_pattern":
      return "题型陌生";
    case "unknown":
      return "未分类";
  }
}

export function reviewSummary(mistake: MistakeDto): string | null {
  if (mistake.reviewSchedule) {
    if (mistake.reviewSchedule.status === "PAUSED") return "排期已暂停";
    return mistake.reviewSchedule.dueDate
      ? formatDate(mistake.reviewSchedule.dueDate)
      : "排期待定";
  }
  return mistake.nextReviewAt ? formatDate(mistake.nextReviewAt) : null;
}

export function matchesMistakeReview(
  mistake: MistakeDto,
  filter: "all" | "due" | "scheduled" | "none",
): boolean {
  if (filter === "all") return true;
  const dueAt = mistake.reviewSchedule?.dueDate ?? mistake.nextReviewAt;
  if (filter === "none") return !dueAt;
  if (!dueAt) return false;
  if (filter === "scheduled") return true;
  return new Date(dueAt).getTime() <= Date.now();
}

export function isMistakeCauseFilter(value: string | undefined): value is "all" | MistakeCauseDto {
  return value === "all"
    || value === "unknown"
    || value === "concept_confusion"
    || value === "formula_unfamiliar"
    || value === "wrong_approach"
    || value === "careless"
    || value === "time_pressure"
    || value === "unfamiliar_pattern";
}

export function isMistakeReviewFilter(
  value: string | undefined,
): value is "all" | "due" | "scheduled" | "none" {
  return value === "all" || value === "due" || value === "scheduled" || value === "none";
}

export function buildMistakeListHref(input: {
  query?: string;
  subject: string;
  node: string;
  cause: "all" | MistakeCauseDto;
  review: "all" | "due" | "scheduled" | "none";
}): string {
  const params = new URLSearchParams();
  if (input.query) params.set("q", input.query);
  if (input.subject !== "all") params.set("subjectId", input.subject);
  if (input.node !== "all") params.set("syllabusNodeId", input.node);
  if (input.cause !== "all") params.set("cause", input.cause);
  if (input.review !== "all") params.set("review", input.review);
  return `/knowledge/mistakes${params.size ? `?${params}` : ""}`;
}
