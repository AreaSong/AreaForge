export type SyllabusMapNodeStatus =
  | "not_started"
  | "learning"
  | "covered"
  | "needs_review"
  | "mastered"
  | "weak"
  | "deferred";

export type SyllabusMapMasteryLevel =
  | "seen"
  | "learned"
  | "basic_exercises"
  | "can_explain"
  | "retest_passed"
  | "exam_stable";

export type SyllabusMapCellStatus =
  | "not_started"
  | "learning"
  | "covered"
  | "verified"
  | "weak"
  | "forgetting_risk"
  | "mistake_hotspot"
  | "deferred";

export type SyllabusMapMarker = "check" | "cross" | "star" | "warning";

export interface SyllabusMapSignalInput {
  nodeStatus: SyllabusMapNodeStatus;
  masteryLevel?: SyllabusMapMasteryLevel | null;
  evidenceCount: number;
  mistakeCount: number;
  daysSinceLastReview?: number | null;
  retestPassed?: boolean;
  isHighFrequency?: boolean;
  isPersonalFocus?: boolean;
}

export interface SyllabusMapSignal {
  cellStatus: SyllabusMapCellStatus;
  markers: SyllabusMapMarker[];
  reasons: string[];
  nextAction: string;
}

export function evaluateSyllabusMapSignal(input: SyllabusMapSignalInput): SyllabusMapSignal {
  const cellStatus = determineSyllabusMapCellStatus(input);
  const markers = determineSyllabusMapMarkers(input, cellStatus);
  const reasons = createSyllabusMapReasons(input, cellStatus);

  return {
    cellStatus,
    markers,
    reasons,
    nextAction: createSyllabusMapNextAction(cellStatus, input),
  };
}

function determineSyllabusMapCellStatus(input: SyllabusMapSignalInput): SyllabusMapCellStatus {
  if (input.nodeStatus === "deferred") return "deferred";
  if (input.mistakeCount >= 3) return "mistake_hotspot";
  if (input.nodeStatus === "weak") return "weak";
  if (input.daysSinceLastReview != null && input.daysSinceLastReview >= 21 && isCoveredLike(input.nodeStatus)) {
    return "forgetting_risk";
  }
  if (input.retestPassed || input.masteryLevel === "retest_passed" || input.masteryLevel === "exam_stable") {
    return "verified";
  }
  if (input.nodeStatus === "mastered" && input.evidenceCount > 0) return "verified";
  if (input.nodeStatus === "covered" || input.nodeStatus === "needs_review" || input.nodeStatus === "mastered") {
    return "covered";
  }
  if (input.nodeStatus === "learning") return "learning";
  return "not_started";
}

function determineSyllabusMapMarkers(
  input: SyllabusMapSignalInput,
  cellStatus: SyllabusMapCellStatus,
): SyllabusMapMarker[] {
  const markers = new Set<SyllabusMapMarker>();

  if (cellStatus === "covered" || cellStatus === "verified") markers.add("check");
  if (cellStatus === "weak" || cellStatus === "mistake_hotspot") markers.add("cross");
  if (input.isHighFrequency || input.isPersonalFocus) markers.add("star");
  if (cellStatus === "forgetting_risk" || cellStatus === "mistake_hotspot" || cellStatus === "weak") markers.add("warning");

  return Array.from(markers);
}

function createSyllabusMapReasons(
  input: SyllabusMapSignalInput,
  cellStatus: SyllabusMapCellStatus,
): string[] {
  const reasons: string[] = [];

  if (input.evidenceCount <= 0 && cellStatus !== "not_started") reasons.push("当前节点缺少掌握证据。");
  if (input.mistakeCount >= 3) reasons.push(`该节点已有 ${input.mistakeCount} 条错题，属于错题高发。`);
  if (input.daysSinceLastReview != null && input.daysSinceLastReview >= 21) {
    reasons.push(`距离上次复习已 ${input.daysSinceLastReview} 天，存在遗忘风险。`);
  }
  if (input.retestPassed || input.masteryLevel === "retest_passed" || input.masteryLevel === "exam_stable") {
    reasons.push("该节点已有复测通过证据。");
  }
  if (input.isHighFrequency) reasons.push("该节点是高频重点。");
  if (input.isPersonalFocus) reasons.push("该节点是个人重点。");

  return reasons.length > 0 ? reasons : [defaultReasonForCell(cellStatus)];
}

function createSyllabusMapNextAction(
  cellStatus: SyllabusMapCellStatus,
  input: SyllabusMapSignalInput,
): string {
  switch (cellStatus) {
    case "not_started":
      return "先安排一个最小学习任务，留下第一条证据。";
    case "learning":
      return "继续推进当前节点，计时结束后补自己的理解。";
    case "covered":
      return input.evidenceCount > 0 ? "安排复测，把覆盖推进到验证。" : "补一条笔记或练习证据。";
    case "verified":
      return "保持复测节奏，避免只凭印象判断掌握。";
    case "weak":
      return "先做错因复盘，再安排一个基础题回炉任务。";
    case "forgetting_risk":
      return "今天安排一次短复习或复测，别等到考前重学。";
    case "mistake_hotspot":
      return "停止扩展新内容，优先压该节点错题和同类题。";
    case "deferred":
      return "确认暂缓原因，只有阶段目标允许时才继续搁置。";
  }
}

function defaultReasonForCell(cellStatus: SyllabusMapCellStatus): string {
  switch (cellStatus) {
    case "not_started":
      return "该节点还没有开始。";
    case "learning":
      return "该节点正在学习中。";
    case "covered":
      return "该节点已有覆盖记录，但仍需验证。";
    case "verified":
      return "该节点已有掌握或复测证据。";
    case "weak":
      return "该节点被标记为薄弱。";
    case "forgetting_risk":
      return "该节点存在遗忘风险。";
    case "mistake_hotspot":
      return "该节点错题较集中。";
    case "deferred":
      return "该节点已暂缓。";
  }
}

function isCoveredLike(status: SyllabusMapNodeStatus): boolean {
  return status === "covered" || status === "needs_review" || status === "mastered";
}
