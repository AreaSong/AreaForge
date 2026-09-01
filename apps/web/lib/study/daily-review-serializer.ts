import type { Prisma } from "@areaforge/db";
import type { DailyReviewDto } from "@/lib/contracts";

export interface SerializableDailyReviewRecord {
  id: string;
  revision: number;
  reviewDate: Date;
  totalMinutes: number;
  effectiveMinutes: number;
  summary: string | null;
  lostControl: string | null;
  keepAction: string | null;
  tomorrowMinimum: string | null;
  mood: string | null;
  aiSuggestion: string | null;
}

export function serializeDailyReview(review: SerializableDailyReviewRecord): DailyReviewDto {
  return {
    id: review.id,
    revision: review.revision,
    reviewDate: review.reviewDate.toISOString(),
    totalMinutes: review.totalMinutes,
    effectiveMinutes: review.effectiveMinutes,
    summary: review.summary,
    lostControl: review.lostControl,
    keepAction: review.keepAction,
    tomorrowMinimum: review.tomorrowMinimum,
    mood: review.mood,
    aiSuggestion: review.aiSuggestion,
  };
}

export function parseDailyReviewSnapshot(value: Prisma.JsonValue | undefined): DailyReviewDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  if (
    typeof snapshot.id !== "string" ||
    typeof snapshot.revision !== "number" ||
    typeof snapshot.reviewDate !== "string" ||
    typeof snapshot.totalMinutes !== "number" ||
    typeof snapshot.effectiveMinutes !== "number"
  ) return null;
  const nullableFields = ["summary", "lostControl", "keepAction", "tomorrowMinimum", "mood", "aiSuggestion"];
  if (!nullableFields.every((field) => snapshot[field] === null || typeof snapshot[field] === "string")) return null;
  return snapshot as unknown as DailyReviewDto;
}
