import type { SimulationStageDraftDto } from "@/lib/contracts";
import type {
  MotivationVaultDto,
  SimulationExamDto,
  StageAdjustmentDraftRecordDto,
  StagePlanDto,
  StudyTaskDto,
  SubjectDto,
} from "@/lib/contracts";
import { isoToShanghaiDateTimeInput } from "@/lib/formatters";

export interface SimulationWorkbenchProps {
  subjects: SubjectDto[];
  exams: SimulationExamDto[];
  tasks: StudyTaskDto[];
  stage: SimulationStageDraftDto;
  stagePlans: StagePlanDto[];
  stageAdjustmentDrafts: StageAdjustmentDraftRecordDto[];
  motivationVault: MotivationVaultDto | null;
  initialNow?: string;
}

export function mergeSubjectResults(
  exam: SimulationExamDto | null,
  current: {
    subjectId: string;
    targetScore?: number;
    actualScore?: number;
    durationMinutes: number;
    blankQuestionCount: number;
    lossReasons: string[];
    summary: string;
  },
) {
  const currentSavedResult = exam?.subjectResults.find((result) => result.subjectId === current.subjectId);
  const serializeResult = (result: SimulationExamDto["subjectResults"][number]) => ({
    subjectId: result.subjectId,
    expectedRevision: result.revision,
    paperFullScore: result.paperFullScore ?? Math.max(result.targetScore ?? 0, result.actualScore ?? 0, 100),
    targetScore: result.targetScore ?? 0,
    actualScore: result.actualScore ?? 0,
    durationMinutes: result.durationMinutes ?? undefined,
    blankQuestionCount: result.blankQuestionCount,
    lossReasons: result.lossReasons,
    summary: result.summary ?? undefined,
    lossItems: result.lossItems
      .filter((item) => item.archivedAt == null)
      .map((item) => ({
        reason: item.reason,
        syllabusNodeId: item.syllabusNodeId,
        lostScore: item.lostScore,
        note: item.note,
      })),
  });
  return [
    ...(exam?.subjectResults ?? [])
      .filter((result) => result.subjectId !== current.subjectId)
      .map(serializeResult),
    {
      ...current,
      expectedRevision: currentSavedResult?.revision,
      paperFullScore: currentSavedResult?.paperFullScore
        ?? Math.max(current.targetScore ?? 0, current.actualScore ?? 0, 100),
      targetScore: current.targetScore ?? 0,
      actualScore: current.actualScore ?? 0,
      lossItems: currentSavedResult ? serializeResult(currentSavedResult).lossItems : [],
    },
  ];
}

export function splitLossReasons(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,，;；、]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 20);
}

export function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function sumNumeric(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => typeof value === "number");
  if (present.length === 0) return undefined;
  return present.reduce((total, value) => total + value, 0);
}

export function toDatetimeLocal(value: string): string {
  return isoToShanghaiDateTimeInput(value);
}

export function formatMaybeNumber(value: number | null | undefined): string {
  if (value == null) return "-";
  return Number.isInteger(value) ? `${value}` : `${Math.round(value * 10) / 10}`;
}

export function labelStageMode(mode: StagePlanDto["mode"]): string {
  switch (mode) {
    case "recovery": return "恢复";
    case "strengthen": return "强化";
    case "sprint": return "冲刺";
    case "maintain": return "维持";
  }
}

export function labelStagePlanStatus(status: StagePlanDto["status"]): string {
  switch (status) {
    case "draft": return "草稿";
    case "active": return "进行中";
    case "completed": return "已完成";
    case "archived": return "已归档";
  }
}

export function labelStageDraftStatus(status: StageAdjustmentDraftRecordDto["status"]): string {
  switch (status) {
    case "draft": return "待确认";
    case "applied": return "已应用";
    case "rejected": return "已驳回";
  }
}

export function labelStageDraftSource(source: StageAdjustmentDraftRecordDto["source"]): string {
  switch (source) {
    case "ai": return "AI 草稿";
    case "local_rule": return "本地规则";
  }
}

export function labelTaskIntensity(intensity: StageAdjustmentDraftRecordDto["taskIntensity"]): string {
  switch (intensity) {
    case "reduce": return "降载";
    case "keep": return "维持";
    case "increase": return "加压";
    case "sprint": return "冲刺";
  }
}
