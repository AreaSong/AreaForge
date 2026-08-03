import {
  canAutoShowMotivationReminder,
  nextReminderStateAfterShow,
  pickMotivationItemId,
  validateMotivationItemPayload,
  type MotivationItemType,
  type MotivationRecoveryAction,
} from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getStudyDayRange } from "./date";
import {
  buildPersistentCreateFingerprint,
  findPersistentCreateReplay,
  normalizeIdempotencyKey,
  recordPersistentCreateResult,
} from "./persistent-idempotency";

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
  reminderReason: "manual" | "ok" | "interval" | "daily_cap" | "empty" | "active_activity" | "no_trigger";
}

export type MotivationVaultField =
  | "whyStarted"
  | "neverReturnTo"
  | "futureSelf"
  | "messageToFuture"
  | "firstSimulationDiary";

const motivationLockNamespace = 2026072701;
const recoveryActions: MotivationRecoveryAction[] = ["CONTINUE", "START_5_MIN", "MINIMUM_TASK"];

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
    idempotencyKey: string;
    type: MotivationItemType;
    title: string;
    body?: string | null;
    externalUrl?: string | null;
    vaultSourceId?: string | null;
    vaultField?: MotivationVaultField;
    tags?: string[];
    enabled?: boolean;
    sortOrder?: number;
  },
): Promise<MotivationItemDto> {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const payload = validateMotivationItemPayload({
    type: input.type,
    body: input.body,
    externalUrl: input.externalUrl,
    vaultSourceId: input.vaultSourceId,
  });
  if (!payload.ok) throw new ApiError("MOTIVATION_ITEM_PAYLOAD_INVALID", 400);
  const requestFingerprint = buildPersistentCreateFingerprint("motivation-item-create-v1", {
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    externalUrl: input.externalUrl ?? null,
    vaultSourceId: input.vaultSourceId ?? null,
    vaultField: input.vaultField ?? null,
    tags: input.tags ?? [],
    enabled: input.enabled ?? true,
    sortOrder: input.sortOrder ?? 0,
  });

  const row = await prisma.$transaction(async (tx) => {
    const command = {
      actorId: userId,
      workspaceId: `user-global:${userId}`,
      action: "MOTIVATION_ITEM_CREATED",
      entityType: "MotivationItem",
      idempotencyKey,
      requestFingerprint,
      conflictCode: "MOTIVATION_ITEM_IDEMPOTENCY_CONFLICT",
    };
    const replay = await findPersistentCreateReplay(tx, command);
    if (replay) {
      const snapshot = parseMotivationItemSnapshot(replay.resultSnapshot);
      if (snapshot) return snapshot;
      const storedItem = await tx.motivationItem.findFirst({ where: { id: replay.resultId, userId } });
      if (!storedItem) throw new ApiError("MOTIVATION_ITEM_IDEMPOTENCY_RESULT_UNAVAILABLE", 409);
      return toDto(storedItem as typeof storedItem & { type: MotivationItemType });
    }

    if (input.type === "VAULT_EXCERPT" && input.vaultSourceId) {
      if (!input.vaultField) throw new ApiError("MOTIVATION_VAULT_FIELD_REQUIRED", 400);
      const vault = await tx.motivationVault.findFirst({
        where: { id: input.vaultSourceId },
      });
      if (!vault) throw new ApiError("MOTIVATION_VAULT_SOURCE_NOT_FOUND", 404);
      const selected = vault[input.vaultField]?.trim() ?? "";
      if (!selected || selected !== input.body?.trim()) {
        throw new ApiError("MOTIVATION_VAULT_EXCERPT_INVALID", 400);
      }
    }

    const created = await tx.motivationItem.create({
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
    const result = toDto(created as typeof created & { type: MotivationItemType });
    await recordPersistentCreateResult(tx, command, created.id, {
      type: created.type,
      enabled: created.enabled,
      resultSnapshot: result as unknown as Prisma.InputJsonObject,
    });
    return result;
  });
  return row;
}

function parseMotivationItemSnapshot(value: Prisma.JsonValue | undefined): MotivationItemDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return typeof value.id === "string" && typeof value.revision === "number"
    ? value as unknown as MotivationItemDto
    : null;
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
  return prisma.$transaction(async (tx) => {
    const existing = await tx.motivationItem.findFirst({
      where: { id: itemId, userId, archivedAt: null },
    });
    if (!existing) throw new ApiError("MOTIVATION_ITEM_NOT_FOUND", 404);

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

    const changed = await tx.motivationItem.updateMany({
      where: { id: existing.id, userId, archivedAt: null, revision: input.expectedRevision },
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
    if (changed.count !== 1) {
      const latest = await tx.motivationItem.findFirst({ where: { id: itemId, userId } });
      if (!latest) throw new ApiError("MOTIVATION_ITEM_NOT_FOUND", 404);
      const latestDto = toDto(latest as typeof latest & { type: MotivationItemType });
      throw new ApiError("MOTIVATION_ITEM_REVISION_CONFLICT", 409, {
        latest: latestDto,
        conflictFields: collectMotivationItemConflictFields(input, latestDto),
        workbench: "/settings/profile",
      });
    }
    const row = await tx.motivationItem.findUniqueOrThrow({ where: { id: existing.id } });
    return toDto(row as typeof row & { type: MotivationItemType });
  });
}

export async function archiveMotivationItem(
  userId: string,
  itemId: string,
  expectedRevision: number,
): Promise<MotivationItemDto> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.motivationItem.findFirst({
      where: { id: itemId, userId, archivedAt: null },
    });
    if (!existing) throw new ApiError("MOTIVATION_ITEM_NOT_FOUND", 404);
    const changed = await tx.motivationItem.updateMany({
      where: { id: existing.id, userId, archivedAt: null, revision: expectedRevision },
      data: {
        archivedAt: new Date(),
        enabled: false,
        revision: { increment: 1 },
        actorId: userId,
      },
    });
    if (changed.count !== 1) {
      const latest = await tx.motivationItem.findFirst({ where: { id: itemId, userId } });
      if (!latest) throw new ApiError("MOTIVATION_ITEM_NOT_FOUND", 404);
      throw new ApiError("MOTIVATION_ITEM_REVISION_CONFLICT", 409, {
        latest: toDto(latest as typeof latest & { type: MotivationItemType }),
        conflictFields: ["revision", "archivedAt"],
        workbench: "/settings/profile",
      });
    }
    const row = await tx.motivationItem.findUniqueOrThrow({ where: { id: existing.id } });
    return toDto(row as typeof row & { type: MotivationItemType });
  });
}

export async function reorderMotivationItems(
  userId: string,
  input: { order: Array<{ id: string; expectedRevision: number }> },
): Promise<MotivationItemDto[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${motivationLockNamespace}, hashtext(${userId}))`;
    const current = await tx.motivationItem.findMany({
      where: { userId, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    });
    const requestedIds = input.order.map((entry) => entry.id);
    const currentIds = current.map((entry) => entry.id);
    const uniqueIds = new Set(requestedIds);
    const revisionsMatch = input.order.every((entry) =>
      current.some((row) => row.id === entry.id && row.revision === entry.expectedRevision),
    );
    if (
      uniqueIds.size !== requestedIds.length
      || requestedIds.length !== currentIds.length
      || currentIds.some((id) => !uniqueIds.has(id))
      || !revisionsMatch
    ) {
      throw new ApiError("MOTIVATION_ITEM_REORDER_CONFLICT", 409, {
        latest: current.map((row) => toDto(row as typeof row & { type: MotivationItemType })),
        conflictFields: ["order", "revision"],
        workbench: "/settings/profile",
      });
    }

    for (const [sortOrder, entry] of input.order.entries()) {
      const existing = current.find((row) => row.id === entry.id);
      if (!existing || existing.sortOrder === sortOrder) continue;
      const changed = await tx.motivationItem.updateMany({
        where: { id: entry.id, userId, archivedAt: null, revision: entry.expectedRevision },
        data: { sortOrder, revision: { increment: 1 }, actorId: userId },
      });
      if (changed.count !== 1) {
        const latest = await tx.motivationItem.findMany({
          where: { userId, archivedAt: null },
          orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
        });
        throw new ApiError("MOTIVATION_ITEM_REORDER_CONFLICT", 409, {
          latest: latest.map((row) => toDto(row as typeof row & { type: MotivationItemType })),
          conflictFields: ["order", "revision"],
          workbench: "/settings/profile",
        });
      }
    }
    const rows = await tx.motivationItem.findMany({
      where: { userId, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    });
    return rows.map((row) => toDto(row as typeof row & { type: MotivationItemType }));
  });
}

function collectMotivationItemConflictFields(
  input: Parameters<typeof updateMotivationItem>[2],
  latest: MotivationItemDto,
): string[] {
  const fields = ["revision"];
  const comparisons: Array<[keyof typeof input, unknown]> = [
    ["title", latest.title],
    ["body", latest.body],
    ["externalUrl", latest.externalUrl],
    ["vaultSourceId", latest.vaultSourceId],
    ["tags", latest.tags],
    ["enabled", latest.enabled],
    ["sortOrder", latest.sortOrder],
  ];
  for (const [field, serverValue] of comparisons) {
    if (input[field] !== undefined && JSON.stringify(input[field]) !== JSON.stringify(serverValue)) fields.push(field);
  }
  return fields;
}

export async function getMotivationNext(
  userId: string,
  options: { mode?: "manual" | "automatic" } = {},
): Promise<MotivationNextDto> {
  if ((options.mode ?? "manual") === "manual") return getManualMotivationNext(userId);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${motivationLockNamespace}, hashtext(${userId}))`;
    const now = new Date();
    const learningDay = getStudyDayRange(now).start;
    const workspace = await tx.examWorkspace.findFirst({ where: { userId, status: "ACTIVE" }, select: { id: true } });
    if (!workspace) return blockedMotivationNext("no_trigger");
    const activeSession = await tx.studySession.findFirst({
      where: { subject: { workspaceId: workspace.id }, status: { in: ["RUNNING", "PAUSED", "CLOSING"] } },
      select: { id: true },
    });
    if (activeSession) return blockedMotivationNext("active_activity");
    const [activeRecovery, lowConversionInbox] = await Promise.all([
      tx.recoveryState.findFirst({
        where: {
          userId,
          workspaceId: workspace.id,
          status: "ACTIVE",
          endedAt: null,
          OR: [{ windowEndDate: null }, { windowEndDate: { gte: learningDay } }],
        },
        select: { id: true },
      }),
      tx.planInboxItem.findFirst({
        where: {
          workspaceId: workspace.id,
          status: "OPEN",
          originType: "LOW_CONVERSION",
          supersededByItemId: null,
        },
        select: { id: true },
      }),
    ]);
    if (!activeRecovery && !lowConversionInbox) return blockedMotivationNext("no_trigger");

    const [items, reminder] = await Promise.all([
      tx.motivationItem.findMany({
        where: { userId, enabled: true, archivedAt: null },
        orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      }),
      tx.motivationReminderState.findUnique({ where: { userId } }),
    ]);
    const gate = canAutoShowMotivationReminder({
      now,
      learningDay: reminder?.learningDay ?? learningDay,
      lastAutoShowAt: reminder?.lastAutoShowAt ?? null,
      dailyCount: reminder?.dailyCount ?? 0,
      currentLearningDay: learningDay,
    });
    if (!gate.allowed) return blockedMotivationNext(gate.reason);
    const itemId = pickMotivationItemId({
      enabledItemIds: items.map((item) => item.id),
      recentItemIds: reminder?.recentItemIds ?? [],
    });
    const item = items.find((row) => row.id === itemId) ?? null;
    if (!item) return blockedMotivationNext("empty");
    const next = nextReminderStateAfterShow({
      now,
      currentLearningDay: learningDay,
      previousLearningDay: reminder?.learningDay ?? null,
      previousDailyCount: reminder?.dailyCount ?? 0,
      previousRecentItemIds: reminder?.recentItemIds ?? [],
      shownItemId: item.id,
    });
    await tx.motivationReminderState.upsert({
      where: { userId },
      create: { userId, ...next },
      update: { ...next, revision: { increment: 1 } },
    });
    return {
      item: toDto(item as typeof item & { type: MotivationItemType }),
      recoveryActions,
      reminderAllowed: true,
      reminderReason: "ok",
    };
  });
}

async function getManualMotivationNext(userId: string): Promise<MotivationNextDto> {
  const [items, reminder] = await Promise.all([
    prisma.motivationItem.findMany({
      where: { userId, enabled: true, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.motivationReminderState.findUnique({ where: { userId } }),
  ]);

  const itemId = pickMotivationItemId({
    enabledItemIds: items.map((item) => item.id),
    recentItemIds: reminder?.recentItemIds ?? [],
  });
  const item = items.find((row) => row.id === itemId) ?? null;

  if (!item) {
    return {
      item: null,
      recoveryActions,
      reminderAllowed: false,
      reminderReason: "empty",
    };
  }

  return {
    item: toDto(item as typeof item & { type: MotivationItemType }),
    recoveryActions,
    reminderAllowed: true,
    reminderReason: "manual",
  };
}

function blockedMotivationNext(
  reason: Exclude<MotivationNextDto["reminderReason"], "manual" | "ok">,
): MotivationNextDto {
  return { item: null, recoveryActions, reminderAllowed: false, reminderReason: reason };
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
