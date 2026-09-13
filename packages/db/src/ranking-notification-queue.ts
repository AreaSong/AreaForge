import { randomUUID } from "node:crypto";
import {
  notificationEventKey, notificationJobFingerprint, notificationJobKey, notificationQueueEnabled,
  parseRankingNotificationEvent, parseRankingNotificationJob, RankingNotificationError, stableStringify,
  type RankingNotificationEvent, type RankingNotificationJob,
} from "@areaforge/core";
import type { Prisma } from "../generated/prisma/client";
import type { QueuedDataJob } from "./data-job-queue-types";
import { enqueueDataJobInTransaction } from "./data-job-queue";
import { lockNotificationAuthorization, mapNotificationDatabaseError } from "./ranking-notification-authorization";
import { assertNotificationSource } from "./ranking-notification-source";

export async function enqueueRankingNotificationJob(tx: Prisma.TransactionClient, input: RankingNotificationEvent, env: Readonly<Record<string, string | undefined>> = process.env) {
  if (!notificationQueueEnabled(env)) return null;
  const event = parseRankingNotificationEvent(input);
  if (event.actorUserId === event.recipientUserId) return null;
  try {
    const authorization = await lockNotificationAuthorization(tx, event, "admission");
    await assertNotificationSource(tx, event, true);
    if (!authorization) return null;
    const { binding } = authorization;
    const payload: RankingNotificationJob = { protocol: "ranking-notification-job-v1", event, eventKey: notificationEventKey(event), authorization: binding };
    const row = await enqueueDataJobInTransaction(tx, {
      kind: "NOTIFICATION", scope: "WORKSPACE", requestedByUserId: event.actorUserId, workspaceId: event.workspaceId,
      idempotencyKey: notificationJobKey(event), requestFingerprint: notificationJobFingerprint(payload),
      payloadJson: payload as unknown as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 86_400_000),
    });
    if (!notificationQueueEnabled(env)) throw new RankingNotificationError("USER_NOTIFICATION_QUEUE_DISABLED", true);
    return row;
  } catch (error) { mapNotificationDatabaseError(error); }
}

export async function deliverRankingNotificationJob(tx: Prisma.TransactionClient, job: Readonly<QueuedDataJob>, env: Readonly<Record<string, string | undefined>> = process.env): Promise<void> {
  if (!notificationQueueEnabled(env)) throw new RankingNotificationError("USER_NOTIFICATION_QUEUE_DISABLED", true);
  const payload = parseRankingNotificationJob(job.resultJson);
  const { event } = payload;
  if (job.queueVersion !== 1 || job.kind !== "NOTIFICATION" || job.scope !== "WORKSPACE"
    || job.requestedByUserId !== event.actorUserId || job.workspaceId !== event.workspaceId || event.actorUserId === event.recipientUserId
    || job.idempotencyKey !== notificationJobKey(event) || job.requestFingerprint !== notificationJobFingerprint(payload)) {
    throw new RankingNotificationError("USER_NOTIFICATION_JOB_BINDING_INVALID");
  }
  try {
    const authorization = await lockNotificationAuthorization(tx, event, "delivery");
    if (!authorization) throw new RankingNotificationError("USER_NOTIFICATION_AUTHORIZATION_REVOKED");
    const { binding, workspaceLabel } = authorization;
    if (stableStringify(binding) !== stableStringify(payload.authorization)) throw new RankingNotificationError("USER_NOTIFICATION_AUTHORIZATION_REVOKED");
    await assertNotificationSource(tx, event, false);
    await writeNotification(tx, event, workspaceLabel);
    if (!notificationQueueEnabled(env)) throw new RankingNotificationError("USER_NOTIFICATION_QUEUE_DISABLED", true);
  } catch (error) { mapNotificationDatabaseError(error); }
}

export async function writeRankingNotificationDirect(tx: Prisma.TransactionClient, input: RankingNotificationEvent, env: Readonly<Record<string, string | undefined>> = process.env) {
  if (env.PLATFORM_NOTIFICATIONS_ENABLED !== "true") return null;
  const event = parseRankingNotificationEvent(input);
  if (event.actorUserId === event.recipientUserId) return null;
  try {
    const authorization = await lockNotificationAuthorization(tx, event, "admission");
    await assertNotificationSource(tx, event, true);
    if (!authorization) return null;
    const { workspaceLabel } = authorization;
    const row = await writeNotification(tx, event, workspaceLabel);
    if (env.PLATFORM_NOTIFICATIONS_ENABLED !== "true") throw new RankingNotificationError("USER_NOTIFICATION_QUEUE_DISABLED", true);
    return row;
  } catch (error) { mapNotificationDatabaseError(error); }
}

async function writeNotification(tx: Prisma.TransactionClient, event: RankingNotificationEvent, workspaceLabel: string) {
  await tx.$executeRaw`
    INSERT INTO "UserNotification" (id, "recipientUserId", "workspaceId", "workspaceLabel", kind, "sourceEntityType", "sourceEntityId", "eventKey", "updatedAt")
    VALUES (${randomUUID()}, ${event.recipientUserId}, ${event.workspaceId}, ${workspaceLabel}, ${event.kind}::"UserNotificationKind", ${event.sourceEntityType}, ${event.sourceEntityId}, ${notificationEventKey(event)}, clock_timestamp())
    ON CONFLICT ("recipientUserId", "eventKey") DO NOTHING
  `;
  const row = await tx.userNotification.findUniqueOrThrow({ where: { recipientUserId_eventKey: { recipientUserId: event.recipientUserId, eventKey: notificationEventKey(event) } } });
  if (row.workspaceId !== event.workspaceId || row.kind !== event.kind || row.sourceEntityType !== event.sourceEntityType || row.sourceEntityId !== event.sourceEntityId) {
    throw new RankingNotificationError("USER_NOTIFICATION_EVENT_KEY_CONFLICT");
  }
  return { id: row.id };
}
