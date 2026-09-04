export const STUDY_RESOURCE_CATEGORY_CATALOG_VERSION = "1.0.0";

export const STUDY_RESOURCE_CATEGORIES = [
  "TEXTBOOK",
  "COURSE",
  "EXERCISE",
  "PAST_PAPER",
  "SOLUTION",
  "SUMMARY",
  "IMAGE",
  "OTHER",
] as const;

export type StudyResourceCategory = (typeof STUDY_RESOURCE_CATEGORIES)[number];

export const STUDY_RESOURCE_CATEGORY_OPTIONS: ReadonlyArray<{
  value: StudyResourceCategory;
  label: string;
}> = [
  { value: "TEXTBOOK", label: "教材/讲义" },
  { value: "COURSE", label: "课程资料" },
  { value: "EXERCISE", label: "习题/题集" },
  { value: "PAST_PAPER", label: "真题/模拟" },
  { value: "SOLUTION", label: "题解/解析" },
  { value: "SUMMARY", label: "总结/速查" },
  { value: "IMAGE", label: "截图/图片" },
  { value: "OTHER", label: "其他" },
];

export function isStudyResourceCategory(value: unknown): value is StudyResourceCategory {
  return typeof value === "string" && (STUDY_RESOURCE_CATEGORIES as readonly string[]).includes(value);
}

export function getStudyResourceCategoryLabel(value: string): string {
  return STUDY_RESOURCE_CATEGORY_OPTIONS.find((item) => item.value === value)?.label ?? value;
}
