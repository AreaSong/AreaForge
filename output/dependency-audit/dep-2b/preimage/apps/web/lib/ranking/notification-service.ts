import { notificationQueueEnabled, RankingNotificationError, type RankingNotificationEvent } from "@areaforge/core";
import { DataJobQueueError, enqueueRankingNotificationJob, writeRankingNotificationDirect, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";

export type EnqueueRankingNotificationInput = RankingNotificationEvent;

export async function enqueueRankingNotification(client: Prisma.TransactionClient, input: EnqueueRankingNotificationInput) {
  if (input.actorUserId === input.recipientUserId) return null;
  try {
    return notificationQueueEnabled(process.env)
      ? await enqueueRankingNotificationJob(client, input)
      : await writeRankingNotificationDirect(client, input);
  } catch (error) {
    if (error instanceof RankingNotificationError || error instanceof DataJobQueueError) throw new ApiError(error.code, 409);
    throw error;
  }
}
