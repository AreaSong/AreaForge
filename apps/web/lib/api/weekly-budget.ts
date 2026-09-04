import { createJsonRequest, requestApiResult, type ApiResult } from "@/lib/api/client";
import type { WeeklyBudgetDto } from "@/lib/contracts";

interface WeeklyBudgetResponse {
  budget?: WeeklyBudgetDto;
  latest?: WeeklyBudgetDto;
  error?: string;
}

export function readWeeklyBudget(weekStart: string): Promise<ApiResult<WeeklyBudgetResponse>> {
  return requestApiResult(`/api/weekly-budget?weekStart=${encodeURIComponent(weekStart)}`, { cache: "no-store" });
}

export function updateWeeklyBudget(input: {
  weekStart: string;
  subjectId: string;
  targetMinutes: number;
  expectedRevision: number;
}): Promise<ApiResult<WeeklyBudgetResponse>> {
  return requestApiResult("/api/weekly-budget", createJsonRequest("PATCH", input));
}
