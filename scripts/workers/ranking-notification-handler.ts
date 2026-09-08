import { USER_NOTIFICATION_KINDS, type UserNotificationKind } from "../../packages/core/src/index";
import type { DataJobHandler, DataJobCommit } from "./data-job-handler";
import { DataJobHandlerError } from "./data-job-handler";

type NotificationSourceEntityType = "PRIVATE_CHALLENGE" | "PRIVATE_CHALLENGE_PARTICIPANT" | "RANKING_APPEAL";

export interface RankingNotificationJobPayload {
  recipientUserId: string;
  workspaceId: string;
  kind: UserNotificationKind;
  sourceEntityType: NotificationSourceEntityType;
  sourceEntityId: string;
  eventKey: string;
}

export function parseRankingNotificationPayload(value: unknown): RankingNotificationJobPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DataJobHandlerError("USER_NOTIFICATION_PAYLOAD_INVALID", false);
  const input = value as Record<string, unknown>;
  const kind = input.kind;
  const sourceEntityType = input.sourceEntityType;
  const fields = [input.recipientUserId, input.workspaceId, kind, sourceEntityType, input.sourceEntityId, input.eventKey];
  if (fields.some((field) => typeof field !== "string" || !field.trim() || field.length > 300)
    || !USER_NOTIFICATION_KINDS.includes(kind as UserNotificationKind)
    || !["PRIVATE_CHALLENGE", "PRIVATE_CHALLENGE_PARTICIPANT", "RANKING_APPEAL"].includes(sourceEntityType as string)) {
    throw new DataJobHandlerError("USER_NOTIFICATION_PAYLOAD_INVALID", false);
  }
  return {
    recipientUserId: input.recipientUserId as string,
    workspaceId: input.workspaceId as string,
    kind: kind as UserNotificationKind,
    sourceEntityType: sourceEntityType as NotificationSourceEntityType,
    sourceEntityId: input.sourceEntityId as string,
    eventKey: input.eventKey as string,
  };
}

export function createRankingNotificationHandler(): DataJobHandler {
  return {
    kind: "NOTIFICATION",
    prepare: async ({ lease }) => {
      const payload = parseRankingNotificationPayload(lease.payloadJson);
      const commit: DataJobCommit = async (tx) => {
        const membership = await tx.workspaceMembership.findFirst({
          where: {
            workspaceId: payload.workspaceId,
            userId: payload.recipientUserId,
            status: "ACTIVE",
            user: { status: "ACTIVE" },
            workspace: { status: "ACTIVE" },
          },
          select: { userId: true, workspace: { select: { id: true, name: true } } },
        });
        if (!membership) throw new DataJobHandlerError("USER_NOTIFICATION_TARGET_INVALID", false);
        const row = await tx.userNotification.upsert({
          where: { recipientUserId_eventKey: { recipientUserId: membership.userId, eventKey: payload.eventKey } },
          create: {
            recipientUserId: membership.userId,
            workspaceId: payload.workspaceId,
            workspaceLabel: membership.workspace.name.trim().slice(0, 120),
            kind: payload.kind,
            sourceEntityType: payload.sourceEntityType,
            sourceEntityId: payload.sourceEntityId,
            eventKey: payload.eventKey,
          },
          update: {},
        });
        if (row.workspaceId !== payload.workspaceId || row.kind !== payload.kind || row.sourceEntityId !== payload.sourceEntityId) {
          throw new DataJobHandlerError("USER_NOTIFICATION_EVENT_KEY_CONFLICT", false);
        }
      };
      return commit;
    },
  };
}
