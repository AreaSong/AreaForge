import { WorkspaceSearchError } from "@areaforge/core";
import { DataJobQueueError, controlWorkspaceSearchIndex, enqueueWorkspaceSearchIndex, getWorkspaceSearchIndexStatus, isDataJobScopeBusy, prisma } from "@areaforge/db";
import { z } from "zod";
import { ApiError } from "@/lib/api/responses";
import { dataJobQuotaErrorStatus } from "@/lib/api/data-job-quota-errors";
import type { CurrentUser } from "@/lib/auth/session";

const workspaceId = z.string().regex(/^[A-Za-z0-9_-]{1,191}$/);
export const searchIndexQuerySchema = z.object({ workspaceId }).strict();
export const searchIndexRequestSchema = z.object({ workspaceId, expectedGeneration: z.number().int().min(0).max(2147483645),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/) }).strict();
export const searchIndexControlSchema = z.object({ workspaceId, expectedRevision: z.number().int().nonnegative(), action: z.enum(["PAUSE", "RESUME", "CANCEL", "REPLAY"]) }).strict();

export async function readSearchIndex(actor: CurrentUser, workspaceId: string) {
  try { return { workspaceId, ...await getWorkspaceSearchIndexStatus(prisma, { actorId: actor.id, sessionId: actor.sessionId, workspaceId }) }; }
  catch (error) { return throwSearchIndexApiError(error); }
}
export async function requestSearchIndex(actor: CurrentUser, input: z.infer<typeof searchIndexRequestSchema>) {
  try { return await enqueueWorkspaceSearchIndex(prisma, { ...input, actorId: actor.id, sessionId: actor.sessionId }); }
  catch (error) { return throwSearchIndexApiError(error); }
}
export async function controlSearchIndex(actor: CurrentUser, jobId: string, input: z.infer<typeof searchIndexControlSchema>) {
  try { return await controlWorkspaceSearchIndex(prisma, { ...input, actorId: actor.id, sessionId: actor.sessionId, jobId }); }
  catch (error) { return throwSearchIndexApiError(error); }
}
export function throwSearchIndexApiError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof WorkspaceSearchError) {
    const status = /SESSION_REVOKED/.test(error.code) ? 401 : /NOT_FOUND|FROZEN|DISABLED/.test(error.code) ? 404
      : /PAYLOAD_INVALID/.test(error.code) ? 400 : error.retryable ? 503 : 409;
    throw new ApiError(error.code, status);
  }
  if (error instanceof DataJobQueueError) throw new ApiError(error.code, dataJobQuotaErrorStatus(error.code) ?? (error.code === "DATA_JOB_QUEUE_NOT_FOUND" ? 404 : 409));
  if (isDataJobScopeBusy(error)) throw new ApiError("SEARCH_INDEX_SCOPE_BUSY", 503);
  throw new ApiError("SEARCH_INDEX_UNAVAILABLE", 503);
}
