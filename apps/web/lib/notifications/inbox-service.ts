import {
  buildUserNotificationContent,
  transitionUserNotification,
  UserNotificationPolicyError,
  type UserNotificationKind,
} from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type {
  UserNotificationAction,
  UserNotificationDto,
  UserNotificationFilter,
} from "@/lib/contracts/notification";
import { isPlatformNotificationsEnabled, requirePlatformNotifications } from "./feature-gate";

type NotificationWriteClient = Pick<Prisma.TransactionClient, "workspaceMembership" | "userNotification">;

export interface EnqueueUserNotificationInput {
  recipientUserId: string;
  workspaceId: string;
  kind: UserNotificationKind;
  sourceEntityType: "PRIVATE_CHALLENGE" | "PRIVATE_CHALLENGE_PARTICIPANT" | "RANKING_APPEAL";
  sourceEntityId: string;
  eventKey: string;
}

export async function enqueueUserNotification(
  client: NotificationWriteClient,
  input: EnqueueUserNotificationInput,
): Promise<UserNotificationDto | null> {
  if (!isPlatformNotificationsEnabled()) return null;
  const normalized = normalizeEnqueueInput(input);
  const membership = await client.workspaceMembership.findFirst({
    where: {
      workspaceId: normalized.workspaceId,
      userId: normalized.recipientUserId,
      status: "ACTIVE",
      user: { status: "ACTIVE" },
      workspace: { status: "ACTIVE" },
    },
    select: { userId: true, workspace: { select: { id: true, name: true } } },
  });
  if (!membership) throw new ApiError("USER_NOTIFICATION_TARGET_INVALID", 409);
  const workspace = membership.workspace;
  const row = await client.userNotification.upsert({
    where: { recipientUserId_eventKey: { recipientUserId: membership.userId, eventKey: normalized.eventKey } },
    create: {
      ...normalized,
      workspaceLabel: workspace.name.trim().slice(0, 120),
    },
    update: {},
  });
  if (row.workspaceId !== normalized.workspaceId
    || row.kind !== normalized.kind
    || row.sourceEntityType !== normalized.sourceEntityType
    || row.sourceEntityId !== normalized.sourceEntityId) {
    throw new ApiError("USER_NOTIFICATION_EVENT_KEY_CONFLICT", 409);
  }
  return serializeNotification(row);
}

export async function listUserNotifications(
  actorId: string,
  filter: UserNotificationFilter,
): Promise<UserNotificationDto[]> {
  requirePlatformNotifications();
  const where: Prisma.UserNotificationWhereInput = {
    recipientUserId: actorId,
    ...(filter === "unread" ? { readAt: null, dismissedAt: null }
      : filter === "dismissed" ? { dismissedAt: { not: null } }
        : { dismissedAt: null }),
  };
  const rows = await prisma.userNotification.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });
  return rows.map(serializeNotification);
}

export async function updateUserNotification(
  actorId: string,
  id: string,
  action: UserNotificationAction,
  expectedRevision: number,
): Promise<UserNotificationDto> {
  requirePlatformNotifications();
  return prisma.$transaction(async (tx) => {
    const existing = await tx.userNotification.findFirst({ where: { id, recipientUserId: actorId } });
    if (!existing) throw new ApiError("USER_NOTIFICATION_NOT_FOUND", 404);
    const next = transitionOrApiError(existing, action, expectedRevision);
    const changed = await tx.userNotification.updateMany({
      where: { id, recipientUserId: actorId, revision: expectedRevision },
      data: {
        readAt: next.readAt ? new Date(next.readAt) : null,
        dismissedAt: next.dismissedAt ? new Date(next.dismissedAt) : null,
        revision: next.revision,
      },
    });
    if (changed.count !== 1) throw new ApiError("USER_NOTIFICATION_REVISION_CONFLICT", 409);
    return serializeNotification(await tx.userNotification.findUniqueOrThrow({ where: { id } }));
  }, { isolationLevel: "Serializable" });
}

function transitionOrApiError(
  row: { revision: number; readAt: Date | null; dismissedAt: Date | null },
  action: UserNotificationAction,
  expectedRevision: number,
) {
  try {
    return transitionUserNotification({
      state: {
        revision: row.revision,
        readAt: row.readAt?.toISOString() ?? null,
        dismissedAt: row.dismissedAt?.toISOString() ?? null,
      },
      action,
      expectedRevision,
      now: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof UserNotificationPolicyError) throw new ApiError(error.code, 409);
    throw error;
  }
}

function serializeNotification(row: {
  id: string;
  workspaceId: string;
  workspaceLabel: string;
  kind: string;
  readAt: Date | null;
  dismissedAt: Date | null;
  revision: number;
  createdAt: Date;
}): UserNotificationDto {
  const kind = row.kind as UserNotificationKind;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    workspaceLabel: row.workspaceLabel,
    kind,
    ...buildUserNotificationContent(kind),
    readAt: row.readAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
  };
}

function normalizeEnqueueInput(input: EnqueueUserNotificationInput): EnqueueUserNotificationInput {
  return {
    ...input,
    recipientUserId: opaque(input.recipientUserId, "recipientUserId"),
    workspaceId: opaque(input.workspaceId, "workspaceId"),
    sourceEntityId: opaque(input.sourceEntityId, "sourceEntityId"),
    eventKey: bounded(input.eventKey, "eventKey", 300),
  };
}

function opaque(value: string, label: string): string {
  const normalized = bounded(value, label, 191);
  if (normalized === "." || normalized === ".." || normalized.includes("/") || normalized.includes("\\")) {
    throw new ApiError("USER_NOTIFICATION_INPUT_INVALID", 400, { conflictFields: [label] });
  }
  return normalized;
}

function bounded(value: string, label: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new ApiError("USER_NOTIFICATION_INPUT_INVALID", 400, { conflictFields: [label] });
  }
  return normalized;
}
