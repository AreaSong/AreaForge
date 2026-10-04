import type {
  StudyTaskDto,
  SyllabusOptionNodeDto,
  TaskDebtReorderDto,
} from "@/lib/contracts";
import { getTaskTypeLabel } from "@areaforge/core";

interface FlatNode {
  id: string;
  subjectId: string;
  title: string;
  depth: number;
}

export function labelDebtAction(action: TaskDebtReorderDto["suggestions"][number]["action"]): string {
  switch (action) {
    case "keep":
      return "保留";
    case "recover":
      return "补做";
    case "defer":
      return "延期";
    case "split":
      return "拆小";
    case "drop":
      return "放弃";
    case "convert_review":
      return "改复习";
  }
}

export function flattenNodes(nodes: SyllabusOptionNodeDto[], depth = 0): FlatNode[] {
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

export function labelPriority(priority: StudyTaskDto["priority"]): string {
  switch (priority) {
    case "critical":
      return "最高";
    case "high":
      return "高";
    case "medium":
      return "中";
    case "low":
      return "低";
  }
}

export function labelTaskType(type: string): string {
  return getTaskTypeLabel(type);
}
