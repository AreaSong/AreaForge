import type { UserNotificationKind } from "@areaforge/core";
import type { Prisma } from "@areaforge/db";
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
