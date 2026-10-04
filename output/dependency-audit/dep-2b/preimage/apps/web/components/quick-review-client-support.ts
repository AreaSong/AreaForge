import type { ReviewEventDto, ReviewScheduleDto } from "@/lib/contracts";

export interface ConfirmResponse {
  schedule: ReviewScheduleDto;
  event: ReviewEventDto;
  reused: boolean;
  nextScheduleId: string | null;
}

export interface ConflictBody {
  error?: string;
  latest?: unknown;
  conflictFields?: string[];
  workbench?: string;
}

export type DraftAccess = "loading" | "writable" | "remote-readonly" | "stale";

export function parseInitialNow(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function readLatestRevision(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const candidate = record.schedule && typeof record.schedule === "object"
    ? record.schedule as { revision?: unknown }
    : record as { revision?: unknown };
  return typeof candidate.revision === "number" ? candidate.revision : null;
}

export function readLatestField(value: unknown, field: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.event && typeof record.event === "object" && field in record.event) {
    return (record.event as Record<string, unknown>)[field];
  }
  if (record.schedule && typeof record.schedule === "object" && field in record.schedule) {
    return (record.schedule as Record<string, unknown>)[field];
  }
  if (record.target && typeof record.target === "object" && field in record.target) {
    return (record.target as Record<string, unknown>)[field];
  }
  return record[field];
}

export function failureWorkbench(body: ConflictBody | ConfirmResponse | null, fallback: string): string {
  return body && "workbench" in body && body.workbench === "/knowledge/reviews"
    ? body.workbench
    : fallback;
}

export function safeConflictWorkbench(value: string | undefined): string | null {
  return value === "/focus" || value === "/knowledge/reviews" ? value : null;
}

export function reviewResultLabel(value: ReviewEventDto["result"]): string {
  return value === "PASSED" ? "通过" : value === "PARTIAL" ? "部分掌握" : "未通过";
}

export function masteryChangeLabel(before: number, after: number): string {
  if (after > before) return `连续通过 ${before} → ${after} 次`;
  if (after < before) return `连续通过已重置为 ${after} 次`;
  return `连续通过保持 ${after} 次`;
}
