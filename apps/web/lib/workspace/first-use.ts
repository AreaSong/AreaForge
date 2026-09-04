import { getExamTemplate, materializeExamTemplate } from "@areaforge/core";

export interface FirstUseTakeoverSubject {
  legacyCode: string | null;
  stableKey?: string;
  name?: string;
}

export interface FirstUseSubjectInput {
  stableKey: string;
  name: string;
  color: string;
  sortOrder: number;
  groupStableKey?: string | null;
}

export interface FirstUseGroupInput {
  stableKey: string;
  name: string;
  sortOrder: number;
}

export interface FirstUseSubjectDraft {
  id: string;
  stableKey: string;
  name: string;
  color: string;
  groupStableKey: string | null;
}

export interface FirstUseGroupDraft {
  id: string;
  stableKey: string;
  name: string;
}

export interface FirstUseRowsValidation {
  valid: boolean;
  issue: string | null;
  configuredSubjectCount: number;
  configuredGroupCount: number;
}

export function canUseTakeoverPreview(preview: unknown): boolean {
  return preview !== null && preview !== undefined;
}

export function hasConfiguredFirstUseSubjects(input: {
  subjectKey: string;
  subjectName: string;
  include408: boolean;
}): boolean {
  return Boolean(
    (input.subjectKey.trim() && input.subjectName.trim())
    || input.include408,
  );
}

export function hasConfiguredFirstUseRows(input: {
  subjects: Array<Pick<FirstUseSubjectDraft, "stableKey" | "name">>;
  templateIds?: string[];
}): boolean {
  return input.subjects.some((subject) => Boolean(subject.stableKey.trim() && subject.name.trim()));
}

export function canProceedFromFirstUseGoal(input: {
  subjectKey: string;
  subjectName: string;
  include408: boolean;
  eligibleTakeoverCount: number;
}): boolean {
  return hasConfiguredFirstUseSubjects(input) || input.eligibleTakeoverCount > 0;
}

export function canProceedFromFirstUseRows(input: {
  subjects: Array<Pick<FirstUseSubjectDraft, "stableKey" | "name">>;
  templateIds?: string[];
  eligibleTakeoverCount: number;
}): boolean {
  return hasConfiguredFirstUseRows(input) || input.eligibleTakeoverCount > 0;
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

function uniqueText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function hasDuplicate(values: string[]): boolean {
  const normalized = values.map(uniqueText).filter(Boolean);
  return new Set(normalized).size !== normalized.length;
}

export function materializeFirstUseTemplateSelection(input: {
  subjects: FirstUseSubjectDraft[];
  groups: FirstUseGroupDraft[];
  templateId: string;
}): { subjects: FirstUseSubjectDraft[]; groups: FirstUseGroupDraft[] } {
  const materialized = materializeExamTemplate(input.templateId);
  if (!materialized) return { subjects: input.subjects, groups: input.groups };

  const groupKeys = new Set(input.groups.map((group) => uniqueText(group.stableKey)));
  const subjectKeys = new Set(input.subjects.map((subject) => uniqueText(subject.stableKey)));
  const subjectNames = new Set(input.subjects.map((subject) => uniqueText(subject.name)));
  const groups = [...input.groups];
  const subjects = [...input.subjects];

  for (const group of materialized.groups) {
    if (groupKeys.has(uniqueText(group.stableKey))) continue;
    groupKeys.add(uniqueText(group.stableKey));
    groups.push({
      id: `template:${input.templateId}:group:${group.stableKey}`,
      stableKey: group.stableKey,
      name: group.name,
    });
  }
  for (const subject of materialized.subjects) {
    if (subjectKeys.has(uniqueText(subject.stableKey)) || subjectNames.has(uniqueText(subject.name))) continue;
    subjectKeys.add(uniqueText(subject.stableKey));
    subjectNames.add(uniqueText(subject.name));
    subjects.push({
      id: `template:${input.templateId}:subject:${subject.stableKey}`,
      stableKey: subject.stableKey,
      name: subject.name,
      color: subject.color,
      groupStableKey: subject.groupStableKey,
    });
  }
  return { subjects, groups };
}

export function validateFirstUseRows(input: {
  subjects: FirstUseSubjectDraft[];
  groups: FirstUseGroupDraft[];
  templateIds?: string[];
}): FirstUseRowsValidation {
  const configuredSubjects = input.subjects.filter((subject) => subject.name.trim() || subject.stableKey.trim());
  const configuredGroups = input.groups.filter((group) => group.name.trim() || group.stableKey.trim());
  const result = (issue: string | null): FirstUseRowsValidation => ({
    valid: issue === null,
    issue,
    configuredSubjectCount: configuredSubjects.length,
    configuredGroupCount: configuredGroups.length,
  });

  if (input.subjects.length > 12) return result("首次最多添加 12 个科目。");
  if (input.groups.length > 20) return result("首次最多添加 20 个分组。");
  if (configuredSubjects.some((subject) => !subject.name.trim() || !subject.stableKey.trim())) {
    return result("每个科目都需要名称和内部标识；不需要的空行可以删除。");
  }
  if (configuredGroups.some((group) => !group.name.trim() || !group.stableKey.trim())) {
    return result("每个分组都需要名称和内部标识；不需要的空行可以删除。");
  }
  if (hasDuplicate(configuredSubjects.map((subject) => subject.stableKey))) {
    return result("科目内部标识不能重复。请修改重复项后继续。");
  }
  if (hasDuplicate(configuredSubjects.map((subject) => subject.name))) {
    return result("科目名称不能重复。若是同一科目，请只保留一项。");
  }
  if (hasDuplicate(configuredGroups.map((group) => group.stableKey))) {
    return result("分组内部标识不能重复。请修改重复项后继续。");
  }
  if (hasDuplicate(configuredGroups.map((group) => group.name))) {
    return result("分组名称不能重复。请修改重复项后继续。");
  }
  const groupKeys = new Set(configuredGroups.map((group) => uniqueText(group.stableKey)));
  if (configuredSubjects.some((subject) => subject.groupStableKey && !groupKeys.has(uniqueText(subject.groupStableKey)))) {
    return result("有科目引用了不存在的分组。请重新选择分组后继续。");
  }
  if ((input.templateIds ?? []).some((templateId) => !getExamTemplate(templateId))) {
    return result("草稿中包含已经失效的模板，请取消后重新选择。");
  }
  return result(null);
}

export function buildFirstUseGroups(input: {
  groups?: FirstUseGroupDraft[];
  subjects?: FirstUseSubjectDraft[];
  templateIds?: string[];
}): FirstUseGroupInput[] {
  const rows: FirstUseGroupInput[] = [];
  const seen = new Set<string>();
  for (const group of input.groups ?? []) {
    const stableKey = group.stableKey.trim();
    const name = group.name.trim();
    if (!stableKey || !name || seen.has(uniqueText(stableKey))) continue;
    seen.add(uniqueText(stableKey));
    rows.push({ stableKey, name, sortOrder: rows.length * 10 + 10 });
  }
  for (const subject of input.subjects ?? []) {
    const stableKey = subject.groupStableKey?.trim();
    if (!stableKey || seen.has(uniqueText(stableKey))) continue;
    seen.add(uniqueText(stableKey));
    rows.push({ stableKey, name: stableKey, sortOrder: rows.length * 10 + 10 });
  }
  return rows;
}

export function buildFirstUseSubjectsFromDraft(input: {
  subjects: FirstUseSubjectDraft[];
  templateIds?: string[];
  takeoverSubjects: FirstUseTakeoverSubject[];
}): FirstUseSubjectInput[] {
  const reusedCodes = new Set(input.takeoverSubjects.map((subject) => subject.legacyCode));
  const reusedKeys = new Set(input.takeoverSubjects.map((subject) => uniqueText(subject.stableKey ?? "")));
  const reusedNames = new Set(input.takeoverSubjects.map((subject) => uniqueText(subject.name ?? "")));
  const rows: FirstUseSubjectInput[] = [];
  const seenKeys = new Set<string>();
  const seenNames = new Set<string>();
  const append = (subject: FirstUseSubjectInput, legacyCode?: string | null) => {
    const stableKey = subject.stableKey.trim();
    const name = subject.name.trim();
    const key = uniqueText(stableKey);
    const label = uniqueText(name);
    if (!stableKey || !name || seenKeys.has(key) || seenNames.has(label)) return;
    if (reusedKeys.has(key) || reusedNames.has(label) || (legacyCode && reusedCodes.has(legacyCode))) return;
    seenKeys.add(key);
    seenNames.add(label);
    rows.push({ ...subject, stableKey, name, sortOrder: rows.length * 10 + 10 });
  };

  for (const subject of input.subjects) {
    append({
      stableKey: subject.stableKey,
      name: subject.name,
      color: subject.color,
      sortOrder: rows.length * 10 + 10,
      groupStableKey: subject.groupStableKey,
    });
  }
  return rows;
}

export function buildFirstUseSubjects(input: {
  subjectKey: string;
  subjectName: string;
  include408: boolean;
  takeoverSubjects: FirstUseTakeoverSubject[];
}): FirstUseSubjectInput[] {
  const reusedCodes = new Set(input.takeoverSubjects.map((subject) => subject.legacyCode));
  const reusedKeys = new Set(input.takeoverSubjects.map((subject) => subject.stableKey).filter(Boolean));
  const reusedNames = new Set(input.takeoverSubjects.map((subject) => subject.name?.trim()).filter(Boolean));
  const subjects: FirstUseSubjectInput[] = [];
  const subjectKey = input.subjectKey.trim();
  const subjectName = input.subjectName.trim();
  const configuredSubjectIsDefaultMath = ["math", "advanced-math"].includes(subjectKey) && subjectName === "高等数学";
  const configuredSubjectAlreadyReused = reusedKeys.has(subjectKey)
    || reusedNames.has(subjectName)
    || (configuredSubjectIsDefaultMath && reusedCodes.has("MATH"));

  if (subjectKey && subjectName && !configuredSubjectAlreadyReused) {
    subjects.push({ stableKey: subjectKey, name: subjectName, color: "#35d7c5", sortOrder: 10 });
  }
  if (input.include408) {
    const materialized = materializeExamTemplate("computer-science-408");
    subjects.push(...(materialized?.subjects ?? [])
      .filter((subject) => !reusedCodes.has(subject.legacyCode ?? null))
      .map((subject) => ({ ...subject, legacyCode: subject.legacyCode ?? null })));
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
  if (code === "WORKSPACE_ACTIVE_SUBJECT_REQUIRED") return "至少填写一个科目、勾选 408 四科，或沿用一个已有科目。";
  if (code === "INTERNAL_ERROR") return "设置未完成，请刷新后重试；草稿仍保留。";
  return code ?? "创建工作区失败，首次设置草稿已保留";
}
