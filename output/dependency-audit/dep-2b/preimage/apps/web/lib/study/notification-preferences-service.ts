import { prisma } from "@areaforge/db";
import { buildForegroundNotificationPayload, type ForegroundNotificationCategory } from "@areaforge/core";
import { ApiError } from "@/lib/api/responses";
import type { NotificationPreferenceDto } from "@/lib/contracts/notification";

export type { NotificationPreferenceDto } from "@/lib/contracts/notification";

const DEFAULT_PREFERENCE: NotificationPreferenceDto = {
  reviewDueEnabled: true,
  planStartEnabled: true,
  eveningReviewEnabled: true,
  reviewDueWindowStart: 8,
  reviewDueWindowEnd: 22,
  planStartWindowStart: 7,
  planStartWindowEnd: 21,
  eveningReviewWindowStart: 20,
  eveningReviewWindowEnd: 23,
  quietHoursStart: null,
  quietHoursEnd: null,
  revision: 0,
};

function toDto(row: {
  reviewDueEnabled: boolean;
  planStartEnabled: boolean;
  eveningReviewEnabled: boolean;
  reviewDueWindowStart: number;
  reviewDueWindowEnd: number;
  planStartWindowStart: number;
  planStartWindowEnd: number;
  eveningReviewWindowStart: number;
  eveningReviewWindowEnd: number;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  revision: number;
}): NotificationPreferenceDto {
  return {
    reviewDueEnabled: row.reviewDueEnabled,
    planStartEnabled: row.planStartEnabled,
    eveningReviewEnabled: row.eveningReviewEnabled,
    reviewDueWindowStart: row.reviewDueWindowStart,
    reviewDueWindowEnd: row.reviewDueWindowEnd,
    planStartWindowStart: row.planStartWindowStart,
    planStartWindowEnd: row.planStartWindowEnd,
    eveningReviewWindowStart: row.eveningReviewWindowStart,
    eveningReviewWindowEnd: row.eveningReviewWindowEnd,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    revision: row.revision,
  };
}

function assertHour(value: number, field: string) {
  if (!Number.isInteger(value) || value < 0 || value > 23) {
    throw new ApiError("NOTIFICATION_WINDOW_INVALID", 400, { conflictFields: [field] });
  }
}

export async function getNotificationPreferences(userId: string): Promise<NotificationPreferenceDto> {
  const row = await prisma.notificationPreference.findUnique({ where: { userId } });
  return row ? toDto(row) : { ...DEFAULT_PREFERENCE };
}

export async function patchNotificationPreferences(
  userId: string,
  input: Partial<Omit<NotificationPreferenceDto, "revision">> & { expectedRevision: number },
): Promise<NotificationPreferenceDto> {
  return prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(8237, hashtext(${userId}))`;
  const existing = await tx.notificationPreference.findUnique({ where: { userId } });
  const currentRevision = existing?.revision ?? 0;
  if (currentRevision !== input.expectedRevision) {
    throw new ApiError("NOTIFICATION_PREFERENCE_REVISION_CONFLICT", 409, {
      latest: existing ? toDto(existing) : { ...DEFAULT_PREFERENCE },
      conflictFields: collectNotificationConflictFields(input, existing ? toDto(existing) : { ...DEFAULT_PREFERENCE }),
      workbench: "/settings/learning",
    });
  }

  const next = {
    reviewDueEnabled: input.reviewDueEnabled ?? existing?.reviewDueEnabled ?? true,
    planStartEnabled: input.planStartEnabled ?? existing?.planStartEnabled ?? true,
    eveningReviewEnabled: input.eveningReviewEnabled ?? existing?.eveningReviewEnabled ?? true,
    reviewDueWindowStart: input.reviewDueWindowStart ?? existing?.reviewDueWindowStart ?? 8,
    reviewDueWindowEnd: input.reviewDueWindowEnd ?? existing?.reviewDueWindowEnd ?? 22,
    planStartWindowStart: input.planStartWindowStart ?? existing?.planStartWindowStart ?? 7,
    planStartWindowEnd: input.planStartWindowEnd ?? existing?.planStartWindowEnd ?? 21,
    eveningReviewWindowStart: input.eveningReviewWindowStart ?? existing?.eveningReviewWindowStart ?? 20,
    eveningReviewWindowEnd: input.eveningReviewWindowEnd ?? existing?.eveningReviewWindowEnd ?? 23,
    quietHoursStart:
      input.quietHoursStart !== undefined ? input.quietHoursStart : (existing?.quietHoursStart ?? null),
    quietHoursEnd: input.quietHoursEnd !== undefined ? input.quietHoursEnd : (existing?.quietHoursEnd ?? null),
  };

  for (const [field, value] of Object.entries({
    reviewDueWindowStart: next.reviewDueWindowStart,
    reviewDueWindowEnd: next.reviewDueWindowEnd,
    planStartWindowStart: next.planStartWindowStart,
    planStartWindowEnd: next.planStartWindowEnd,
    eveningReviewWindowStart: next.eveningReviewWindowStart,
    eveningReviewWindowEnd: next.eveningReviewWindowEnd,
  })) {
    assertHour(value as number, field);
  }
  if (next.quietHoursStart != null) assertHour(next.quietHoursStart, "quietHoursStart");
  if (next.quietHoursEnd != null) assertHour(next.quietHoursEnd, "quietHoursEnd");

  const row = await tx.notificationPreference.upsert({
    where: { userId },
    create: {
      userId,
      ...next,
      revision: 1,
    },
    update: {
      ...next,
      revision: { increment: 1 },
    },
  });
  return toDto(row);
  });
}

function collectNotificationConflictFields(
  input: Partial<Omit<NotificationPreferenceDto, "revision">> & { expectedRevision: number },
  latest: NotificationPreferenceDto,
): string[] {
  const fields = ["revision"];
  for (const [field, value] of Object.entries(input)) {
    if (field === "expectedRevision") continue;
    if (JSON.stringify(value) !== JSON.stringify(latest[field as keyof NotificationPreferenceDto])) fields.push(field);
  }
  return fields;
}

/** Minimal foreground notification payload — never includes task/syllabus/motivation titles. */
export function buildTestNotificationPayload(category: ForegroundNotificationCategory) {
  return buildForegroundNotificationPayload(category);
}
