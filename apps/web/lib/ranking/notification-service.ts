import { hashDataExportValue, type UserNotificationKind } from "@areaforge/core";
import { enqueueDataJobInTransaction, type Prisma } from "@areaforge/db";
import { enqueueUserNotification } from "@/lib/notifications/inbox-service";

export interface EnqueueRankingNotificationInput {
  actorUserId: string;
  recipientUserId: string;
  workspaceId: string;
  kind: UserNotificationKind;
  sourceEntityType: "PRIVATE_CHALLENGE" | "PRIVATE_CHALLENGE_PARTICIPANT" | "RANKING_APPEAL";
  sourceEntityId: string;
  eventVersion: number;
}

export function enqueueRankingNotification(
  client: Prisma.TransactionClient,
  input: EnqueueRankingNotificationInput,
) {
  if (input.actorUserId === input.recipientUserId) return Promise.resolve(null);
  if (process.env.PLATFORM_NOTIFICATIONS_ENABLED === "true" && process.env.PLATFORM_NOTIFICATION_QUEUE_ENABLED === "true") {
    const payload = {
      recipientUserId: input.recipientUserId,
      workspaceId: input.workspaceId,
      kind: input.kind,
      sourceEntityType: input.sourceEntityType,
      sourceEntityId: input.sourceEntityId,
      eventKey: ["ranking", input.kind, input.sourceEntityType, input.sourceEntityId, input.eventVersion].join(":"),
    } as const;
    const requestFingerprint = hashDataExportValue(payload);
    return enqueueDataJobInTransaction(client, {
      kind: "NOTIFICATION",
      scope: "WORKSPACE",
      requestedByUserId: input.actorUserId,
      workspaceId: input.workspaceId,
      idempotencyKey: `ranking-notification-${requestFingerprint.slice(7)}`,
      requestFingerprint,
      payloadJson: payload,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
  }
  return enqueueUserNotification(client, {
    recipientUserId: input.recipientUserId,
    workspaceId: input.workspaceId,
    kind: input.kind,
    sourceEntityType: input.sourceEntityType,
    sourceEntityId: input.sourceEntityId,
    eventKey: [
      "ranking",
      input.kind,
      input.sourceEntityType,
      input.sourceEntityId,
      input.eventVersion,
    ].join(":"),
  });
}
