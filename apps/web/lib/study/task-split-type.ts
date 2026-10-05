import { resolveDraftTaskType } from "@areaforge/core";
import { ApiError } from "@/lib/api/responses";

export function requireSplitTaskType(value: string) {
  const type = value.trim() ? resolveDraftTaskType(value) : null;
  if (!type) throw new ApiError("TASK_TYPE_INVALID", 400, { conflictFields: ["type"] });
  return type === "simulation_exam" ? "review" : type;
}
