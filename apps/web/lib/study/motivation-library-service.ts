import {
  canAutoShowMotivationReminder,
  nextReminderStateAfterShow,
  pickMotivationItemId,
  validateMotivationItemPayload,
  type MotivationItemType,
  type MotivationRecoveryAction,
} from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getStudyDayRange } from "./date";

export interface MotivationItemDto {
  id: string;
  type: MotivationItemType;
  title: string;
  body: string | null;
  externalUrl: string | null;
  vaultSourceId: string | null;
  tags: string[];
  enabled: boolean;
  sortOrder: number;
  revision: number;
  archivedAt: string | null;
  updatedAt: string;
}

export interface MotivationNextDto {
  item: MotivationItemDto | null;
  recoveryActions: MotivationRecoveryAction[];
  reminderAllowed: boolean;
  reminderReason: "ok" | "interval" | "daily_cap" | "empty";
}

function toDto(row: {
  id: string;
  type: MotivationItemType;
  title: string;
  body: string | null;
  externalUrl: string | null;
  vaultSourceId: string | null;
  tags: string[];
  enabled: boolean;
  sortOrder: number;
  revision: number;
  archivedAt: Date | null;
  updatedAt: Date;
}): MotivationItemDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    externalUrl: row.externalUrl,
    vaultSourceId: row.vaultSourceId,
    tags: row.tags,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    revision: row.revision,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listMotivationItems(userId: string, includeArchived = false): Promise<MotivationItemDto[]> {
  const rows = await prisma.motivationItem.findMany({
    where: {
      userId,
      ...(includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
  });
  return rows.map((row) => toDto(row as typeof row & { type: MotivationItemType }));
}

export async function createMotivationItem(
  userId: string,
  input: {
    type: MotivationItemType;
    title: string;
    body?: string | null;
    externalUrl?: string | null;
    vaultSourceId?: string | null;
    tags?: string[];
    enabled?: boolean;
    sortOrder?: number;
  },
): Promise<MotivationItemDto> {
  const payload = validateMotivationItemPayload({
    type: input.type,
    body: input.body,
    externalUrl: input.externalUrl,
    vaultSourceId: input.vaultSourceId,
  });
  if (!payload.ok) throw new ApiError("MOTIVATION_ITEM_PAYLOAD_INVALID", 400);

  if (input.type === "VAULT_EXCERPT" && input.vaultSourceId) {
    const vault = await prisma.motivationVault.findFirst({
      where: { id: input.vaultSourceId },
      select: { id: true },
    });
    if (!vault) throw new ApiError("MOTIVATION_VAULT_SOURCE_NOT_FOUND", 404);
  }

  const row = await prisma.motivationItem.create({
    data: {
      userId,
      type: input.type,
      title: input.title.trim(),
      body: input.body?.trim() || null,
      externalUrl: input.externalUrl?.trim() || null,
      vaultSourceId: input.vaultSourceId?.trim() || null,
      tags: input.tags ?? [],
      enabled: input.enabled ?? true,
      sortOrder: input.sortOrder ?? 0,
      actorId: userId,
    },
  });
  return toDto(row as typeof row & { type: MotivationItemType });
}

export async function updateMotivationItem(
  userId: string,
  itemId: string,
  input: {
    expectedRevision: number;
    title?: string;
    body?: string | null;
    externalUrl?: string | null;
    vaultSourceId?: string | null;
    tags?: string[];
    enabled?: boolean;
    sortOrder?: number;
  },
): Promise<MotivationItemDto> {
  const existing = await prisma.motivationItem.findFirst({
    where: { id: itemId, userId, archivedAt: null },
  });
  if (!existing) throw new ApiError("MOTIVATION_ITEM_NOT_FOUND", 404);
  if (existing.revision !== input.expectedRevision) {
    throw new ApiError("MOTIVATION_ITEM_REVISION_CONFLICT", 409, {
      latest: toDto(existing as typeof existing & { type: MotivationItemType }),
      conflictFields: ["revision"],
    });
  }

  const nextType = existing.type as MotivationItemType;
  const nextBody = input.body !== undefined ? input.body : existing.body;
  const nextUrl = input.externalUrl !== undefined ? input.externalUrl : existing.externalUrl;
  const nextVault = input.vaultSourceId !== undefined ? input.vaultSourceId : existing.vaultSourceId;
  const payload = validateMotivationItemPayload({
    type: nextType,
    body: nextBody,
    externalUrl: nextUrl,
    vaultSourceId: nextVault,
  });
  if (!payload.ok) throw new ApiError("MOTIVATION_ITEM_PAYLOAD_INVALID", 400);

  const row = await prisma.motivationItem.update({
    where: { id: existing.id },
    data: {
      title: input.title?.trim() ?? existing.title,
      body: nextBody?.trim() || null,
      externalUrl: nextUrl?.trim() || null,
      vaultSourceId: nextVault?.trim() || null,
      tags: input.tags ?? existing.tags,
      enabled: input.enabled ?? existing.enabled,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      revision: { increment: 1 },
      actorId: userId,
    },
  });
  return toDto(row as typeof row & { type: MotivationItemType });
}

export async function archiveMotivationItem(
  userId: string,
  itemId: string,
  expectedRevision: number,
): Promise<MotivationItemDto> {
  const existing = await prisma.motivationItem.findFirst({
    where: { id: itemId, userId, archivedAt: null },
  });
  if (!existing) throw new ApiError("MOTIVATION_ITEM_NOT_FOUND", 404);
  if (existing.revision !== expectedRevision) {
    throw new ApiError("MOTIVATION_ITEM_REVISION_CONFLICT", 409, {
      latest: toDto(existing as typeof existing & { type: MotivationItemType }),
      conflictFields: ["revision"],
    });
  }
  const row = await prisma.motivationItem.update({
    where: { id: existing.id },
    data: {
      archivedAt: new Date(),
      enabled: false,
      revision: { increment: 1 },
      actorId: userId,
    },
  });
  return toDto(row as typeof row & { type: MotivationItemType });
}

export async function getMotivationNext(
  userId: string,
  options: { recordReminder?: boolean } = {},
): Promise<MotivationNextDto> {
  const now = new Date();
  const learningDay = getStudyDayRange(now).start;
  const [items, reminder] = await Promise.all([
    prisma.motivationItem.findMany({
      where: { userId, enabled: true, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.motivationReminderState.findUnique({ where: { userId } }),
  ]);

  const gate = canAutoShowMotivationReminder({
    now,
    learningDay: reminder?.learningDay ?? learningDay,
    lastAutoShowAt: reminder?.lastAutoShowAt ?? null,
    dailyCount: reminder?.dailyCount ?? 0,
    currentLearningDay: learningDay,
  });

  const itemId = pickMotivationItemId({
    enabledItemIds: items.map((item) => item.id),
    recentItemIds: reminder?.recentItemIds ?? [],
  });
  const item = items.find((row) => row.id === itemId) ?? null;

  if (!item) {
    return {
      item: null,
      recoveryActions: ["CONTINUE", "START_5_MIN", "MINIMUM_TASK"],
      reminderAllowed: false,
      reminderReason: "empty",
    };
  }

  if (!gate.allowed) {
    return {
      item: toDto(item as typeof item & { type: MotivationItemType }),
      recoveryActions: ["CONTINUE", "START_5_MIN", "MINIMUM_TASK"],
      reminderAllowed: false,
      reminderReason: gate.reason,
    };
  }

  if (options.recordReminder) {
    const next = nextReminderStateAfterShow({
      now,
      currentLearningDay: learningDay,
      previousLearningDay: reminder?.learningDay ?? null,
      previousDailyCount: reminder?.dailyCount ?? 0,
      previousRecentItemIds: reminder?.recentItemIds ?? [],
      shownItemId: item.id,
    });
    await prisma.motivationReminderState.upsert({
      where: { userId },
      create: {
        userId,
        lastAutoShowAt: next.lastAutoShowAt,
        learningDay: next.learningDay,
        dailyCount: next.dailyCount,
        recentItemIds: next.recentItemIds,
      },
      update: {
        lastAutoShowAt: next.lastAutoShowAt,
        learningDay: next.learningDay,
        dailyCount: next.dailyCount,
        recentItemIds: next.recentItemIds,
        revision: { increment: 1 },
      },
    });
  }

  return {
    item: toDto(item as typeof item & { type: MotivationItemType }),
    recoveryActions: ["CONTINUE", "START_5_MIN", "MINIMUM_TASK"],
    reminderAllowed: true,
    reminderReason: "ok",
  };
}

export async function updateMotivationReminderState(
  userId: string,
  input: { expectedRevision: number; shownItemId: string },
): Promise<{ revision: number }> {
  const now = new Date();
  const learningDay = getStudyDayRange(now).start;
  const existing = await prisma.motivationReminderState.findUnique({ where: { userId } });
  if (existing && existing.revision !== input.expectedRevision) {
    throw new ApiError("MOTIVATION_REMINDER_REVISION_CONFLICT", 409, {
      latest: { revision: existing.revision },
      conflictFields: ["revision"],
    });
  }

  const item = await prisma.motivationItem.findFirst({
    where: { id: input.shownItemId, userId, archivedAt: null },
    select: { id: true },
  });
  if (!item) throw new ApiError("MOTIVATION_ITEM_NOT_FOUND", 404);

  const next = nextReminderStateAfterShow({
    now,
    currentLearningDay: learningDay,
    previousLearningDay: existing?.learningDay ?? null,
    previousDailyCount: existing?.dailyCount ?? 0,
    previousRecentItemIds: existing?.recentItemIds ?? [],
    shownItemId: input.shownItemId,
  });

  const row = await prisma.motivationReminderState.upsert({
    where: { userId },
    create: {
      userId,
      lastAutoShowAt: next.lastAutoShowAt,
      learningDay: next.learningDay,
      dailyCount: next.dailyCount,
      recentItemIds: next.recentItemIds,
      revision: 1,
    },
    update: {
      lastAutoShowAt: next.lastAutoShowAt,
      learningDay: next.learningDay,
      dailyCount: next.dailyCount,
      recentItemIds: next.recentItemIds,
      revision: { increment: 1 },
    },
  });
  return { revision: row.revision };
}
