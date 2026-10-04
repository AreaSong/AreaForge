export const TASK_TYPE_CATALOG_VERSION = "1.0.0";

export const TASK_TYPES = ["study", "review", "practice", "mistake", "simulation_exam"] as const;
export const LEGACY_TASK_TYPES = ["focus"] as const;
export const SUPPORTED_TASK_TYPES = [...TASK_TYPES, ...LEGACY_TASK_TYPES] as const;

export type TaskType = (typeof TASK_TYPES)[number];
export type SupportedTaskType = (typeof SUPPORTED_TASK_TYPES)[number];

export interface TaskTypeDefinition {
  value: TaskType;
  label: string;
  description: string;
}

export const TASK_TYPE_DEFINITIONS: readonly TaskTypeDefinition[] = [
  { value: "study", label: "学习", description: "课程、教材或普通知识学习。" },
  { value: "review", label: "复习", description: "回顾已经接触过的内容。" },
  { value: "practice", label: "刷题", description: "以练习和输出为主要目标。" },
  { value: "mistake", label: "错题", description: "围绕既有失分进行订正。" },
  { value: "simulation_exam", label: "模拟", description: "按考试节奏执行的模拟任务。" },
];

export function isTaskType(value: unknown): value is TaskType {
  return typeof value === "string" && (TASK_TYPES as readonly string[]).includes(value);
}

export function isSupportedTaskType(value: unknown): value is SupportedTaskType {
  return typeof value === "string" && (SUPPORTED_TASK_TYPES as readonly string[]).includes(value);
}

export function getTaskTypeLabel(value: string): string {
  if (value === "focus") return "学习";
  return TASK_TYPE_DEFINITIONS.find((item) => item.value === value)?.label ?? value;
}
