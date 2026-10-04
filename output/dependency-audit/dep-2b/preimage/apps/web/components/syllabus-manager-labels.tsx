import type { SyllabusMapOverviewDto, SyllabusNodeDto, SyllabusNodeKindDto, SyllabusNodeStatusDto } from "@/lib/contracts";
import type {
  ActionFilter,
  AddMasteryEvidenceBody,
  MasteryCondition,
  MasteryEvidenceType,
  MasteryRetestResult,
} from "@/components/syllabus-manager-types";

export const statusFilterOptions: SyllabusNodeStatusDto[] = [
  "not_started",
  "learning",
  "covered",
  "needs_review",
  "mastered",
  "weak",
  "deferred",
];

export const mapStatusOptions: SyllabusNodeDto["mapSignal"]["cellStatus"][] = [
  "mistake_hotspot",
  "weak",
  "forgetting_risk",
  "covered",
  "verified",
  "learning",
  "not_started",
  "deferred",
];

export const actionFilterOptions: Array<{ value: Exclude<ActionFilter, "all">; label: string }> = [
  { value: "risk", label: "风险压制" },
  { value: "evidence", label: "补证据" },
  { value: "review", label: "复习复测" },
  { value: "start", label: "启动推进" },
  { value: "deferred", label: "暂缓确认" },
];

export const masteryConditionOptions: MasteryCondition[] = [
  "course_or_textbook",
  "own_explanation",
  "basic_exercise",
  "comprehensive_exercise",
  "mistake_reviewed",
  "delayed_retest",
];

export const masteryEvidenceTypeOptions: Array<{ value: MasteryEvidenceType; label: string }> = [
  { value: "task", label: "任务" },
  { value: "session", label: "计时" },
  { value: "note", label: "笔记" },
  { value: "mistake", label: "错题" },
  { value: "retest", label: "复测" },
];

export const masteryRetestResultOptions: Array<{ value: MasteryRetestResult; label: string }> = [
  { value: "passed", label: "通过" },
  { value: "partial", label: "部分通过" },
  { value: "failed", label: "未通过" },
];

export function StatusOptions() {
  return (
    <>
      <option value="not_started">未开始</option>
      <option value="learning">学习中</option>
      <option value="covered">已覆盖</option>
      <option value="needs_review">需要复习</option>
      <option value="mastered">掌握</option>
      <option value="weak">薄弱</option>
      <option value="deferred">暂缓</option>
    </>
  );
}

export function labelEvidenceFreshness(days: number | null): string {
  if (days == null) return "暂无";
  if (days === 0) return "今天";
  return `${days} 天前`;
}

export function labelEvidenceSource(source: SyllabusNodeDto["evidence"]["source"]): string {
  switch (source) {
    case "explicit":
      return "显式记录";
    case "fallback_count":
      return "_count fallback";
  }
}

export function getMasteryEvidenceReferenceKey(
  evidenceType: MasteryEvidenceType,
): Exclude<keyof AddMasteryEvidenceBody, "evidenceType" | "summary"> {
  switch (evidenceType) {
    case "task":
      return "taskId";
    case "session":
      return "sessionId";
    case "note":
      return "noteId";
    case "mistake":
      return "mistakeId";
    case "retest":
      return "retestId";
  }
}

export function labelKind(kind: SyllabusNodeKindDto): string {
  switch (kind) {
    case "subject":
      return "科目";
    case "chapter":
      return "章节";
    case "topic":
      return "知识点";
    case "problem_type":
      return "题型专题";
  }
}

export function labelStatus(status: SyllabusNodeStatusDto): string {
  switch (status) {
    case "not_started":
      return "未开始";
    case "learning":
      return "学习中";
    case "covered":
      return "已覆盖";
    case "needs_review":
      return "需要复习";
    case "mastered":
      return "掌握";
    case "weak":
      return "薄弱";
    case "deferred":
      return "暂缓";
  }
}

export function labelMapCell(status: SyllabusNodeDto["mapSignal"]["cellStatus"]): string {
  switch (status) {
    case "not_started":
      return "未开始";
    case "learning":
      return "学习中";
    case "covered":
      return "已覆盖";
    case "verified":
      return "已验证";
    case "weak":
      return "薄弱";
    case "forgetting_risk":
      return "遗忘风险";
    case "mistake_hotspot":
      return "错题高发";
    case "deferred":
      return "暂缓";
  }
}

export function labelMapRisk(risk: SyllabusMapOverviewDto["summary"]["riskLevel"]): string {
  switch (risk) {
    case "clear":
      return "清晰";
    case "attention":
      return "需关注";
    case "high":
      return "高风险";
    case "critical":
      return "紧急";
  }
}

export function labelMasteryCondition(
  condition: SyllabusNodeDto["masteryProof"]["missingConditions"][number],
): string {
  switch (condition) {
    case "course_or_textbook":
      return "看完课程或教材";
    case "own_explanation":
      return "自己的理解";
    case "basic_exercise":
      return "基础题";
    case "comprehensive_exercise":
      return "综合题";
    case "mistake_reviewed":
      return "错题复盘";
    case "delayed_retest":
      return "7 天后复测";
  }
}

export function labelMasteryEvidenceType(type: MasteryEvidenceType): string {
  return masteryEvidenceTypeOptions.find((option) => option.value === type)?.label ?? type;
}

export function labelMasteryRetestResult(result: MasteryRetestResult): string {
  switch (result) {
    case "passed":
      return "通过";
    case "partial":
      return "部分通过";
    case "failed":
      return "未通过";
  }
}
