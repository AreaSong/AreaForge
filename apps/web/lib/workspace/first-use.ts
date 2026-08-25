export interface FirstUseTakeoverSubject {
  legacyCode: string | null;
}

export interface FirstUseSubjectInput {
  stableKey: string;
  name: string;
  color: string;
  sortOrder: number;
  groupStableKey?: "408";
}

export function canUseTakeoverPreview(preview: unknown): boolean {
  return preview !== null && preview !== undefined;
}

export function nextAvailableGeneratedKey(
  prefix: "subject" | "group",
  stableKeys: Iterable<string>,
): string {
  const used = new Set(stableKeys);
  let suffix = 1;
  while (used.has(`${prefix}-${suffix}`)) suffix += 1;
  return `${prefix}-${suffix}`;
}

const default408Subjects: Array<FirstUseSubjectInput & { legacyCode: FirstUseTakeoverSubject["legacyCode"] }> = [
  { stableKey: "408-data-structure", legacyCode: "DATA_STRUCTURE", name: "数据结构", color: "#22c55e", sortOrder: 20, groupStableKey: "408" },
  { stableKey: "408-computer-organization", legacyCode: "COMPUTER_ORGANIZATION", name: "计算机组成原理", color: "#f59e0b", sortOrder: 30, groupStableKey: "408" },
  { stableKey: "408-operating-system", legacyCode: "OPERATING_SYSTEM", name: "操作系统", color: "#3b82f6", sortOrder: 40, groupStableKey: "408" },
  { stableKey: "408-computer-network", legacyCode: "COMPUTER_NETWORK", name: "计算机网络", color: "#ef4444", sortOrder: 50, groupStableKey: "408" },
];

export function buildFirstUseSubjects(input: {
  subjectKey: string;
  subjectName: string;
  include408: boolean;
  takeoverSubjects: FirstUseTakeoverSubject[];
}): FirstUseSubjectInput[] {
  const reusedCodes = new Set(input.takeoverSubjects.map((subject) => subject.legacyCode));
  const subjects: FirstUseSubjectInput[] = [];
  const subjectKey = input.subjectKey.trim();
  const subjectName = input.subjectName.trim();
  const configuredSubjectIsDefaultMath = ["math", "advanced-math"].includes(subjectKey)
    && subjectName === "高等数学";

  if (!configuredSubjectIsDefaultMath || !reusedCodes.has("MATH")) {
    subjects.push({ stableKey: subjectKey, name: subjectName, color: "#35d7c5", sortOrder: 10 });
  }
  if (input.include408) {
    subjects.push(...default408Subjects.filter((subject) => !reusedCodes.has(subject.legacyCode)));
  }
  return subjects;
}

export function workspaceSetupErrorMessage(code: string | undefined): string {
  if (code === "SUBJECT_STABLE_KEY_CONFLICT_WITH_TAKEOVER") {
    return "新科目与已有科目的内部标识重复。请返回修改，或选择沿用已有科目。";
  }
  if (code === "TAKEOVER_SUBJECT_NOT_ELIGIBLE") {
    return "旧数据状态已经变化，请刷新预览后重新确认。";
  }
  if (code === "SUBJECT_STABLE_KEY_DUPLICATE") return "新科目的内部标识重复，请返回修改。";
  if (code === "INTERNAL_ERROR") return "设置未完成，请刷新后重试；草稿仍保留。";
  return code ?? "创建工作区失败，首次设置草稿已保留";
}
