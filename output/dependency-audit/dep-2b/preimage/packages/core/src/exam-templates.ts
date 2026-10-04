/**
 * Versioned exam templates are seed material only. Once selected, callers copy
 * the rows into ordinary workspace-owned groups and subjects so later edits do
 * not depend on a hidden template branch.
 */
export const EXAM_TEMPLATE_CATALOG_VERSION = "2026-09-04";

export interface ExamTemplateSubject {
  stableKey: string;
  name: string;
  color: string;
  sortOrder: number;
  legacyCode?: string;
}

export interface ExamTemplateGroup {
  stableKey: string;
  name: string;
  sortOrder: number;
  subjects: readonly ExamTemplateSubject[];
}

export interface ExamTemplate {
  id: string;
  version: string;
  name: string;
  description: string;
  groups: readonly ExamTemplateGroup[];
}

export interface ExamTemplateLegacySubjectMatch {
  templateId: string;
  templateVersion: string;
  groupStableKey: string;
  groupName: string;
  groupSortOrder: number;
  subject: ExamTemplateSubject;
}

const templates: readonly ExamTemplate[] = [
  {
    id: "postgraduate-common",
    version: "1.0.0",
    name: "考研公共课",
    description: "数学、英语、政治的可编辑起始结构。",
    groups: [
      {
        stableKey: "common",
        name: "公共课",
        sortOrder: 10,
        subjects: [
          { stableKey: "common-math", name: "数学", color: "#35d7c5", sortOrder: 10, legacyCode: "MATH" },
          { stableKey: "common-english", name: "英语", color: "#3b82f6", sortOrder: 20, legacyCode: "ENGLISH" },
          { stableKey: "common-politics", name: "政治", color: "#ef4444", sortOrder: 30, legacyCode: "POLITICS" },
        ],
      },
    ],
  },
  {
    id: "computer-science-408",
    version: "1.0.0",
    name: "计算机统考 408",
    description: "四门专业课的可编辑起始结构。",
    groups: [
      {
        stableKey: "408",
        name: "408",
        sortOrder: 40,
        subjects: [
          { stableKey: "408-data-structure", name: "数据结构", color: "#22c55e", sortOrder: 10, legacyCode: "DATA_STRUCTURE" },
          { stableKey: "408-computer-organization", name: "计算机组成原理", color: "#f59e0b", sortOrder: 20, legacyCode: "COMPUTER_ORGANIZATION" },
          { stableKey: "408-operating-system", name: "操作系统", color: "#3b82f6", sortOrder: 30, legacyCode: "OPERATING_SYSTEM" },
          { stableKey: "408-computer-network", name: "计算机网络", color: "#ef4444", sortOrder: 40, legacyCode: "COMPUTER_NETWORK" },
        ],
      },
    ],
  },
];

export function listExamTemplates(): readonly ExamTemplate[] {
  return templates;
}

export function getExamTemplate(templateId: string): ExamTemplate | null {
  return templates.find((template) => template.id === templateId) ?? null;
}

export function findExamTemplateSubjectByLegacyCode(
  legacyCode: string | null | undefined,
): ExamTemplateLegacySubjectMatch | null {
  if (!legacyCode) return null;
  const normalized = legacyCode.trim().toLocaleUpperCase();
  for (const template of templates) {
    for (const group of template.groups) {
      const subject = group.subjects.find((candidate) => candidate.legacyCode?.toLocaleUpperCase() === normalized);
      if (!subject) continue;
      return {
        templateId: template.id,
        templateVersion: template.version,
        groupStableKey: group.stableKey,
        groupName: group.name,
        groupSortOrder: group.sortOrder,
        subject: { ...subject },
      };
    }
  }
  return null;
}

export function materializeExamTemplate(templateId: string): {
  groups: ExamTemplateGroup[];
  subjects: Array<ExamTemplateSubject & { groupStableKey: string }>;
} | null {
  const template = getExamTemplate(templateId);
  if (!template) return null;
  return {
    groups: template.groups.map((group) => ({
      ...group,
      subjects: group.subjects.map((subject) => ({ ...subject })),
    })),
    subjects: template.groups.flatMap((group) => group.subjects.map((subject) => ({
      ...subject,
      groupStableKey: group.stableKey,
    }))),
  };
}
