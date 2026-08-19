import { prisma, type Prisma } from "@areaforge/db";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api/responses";
import {
  buildPersistentCreateFingerprint,
  normalizeIdempotencyKey,
} from "./persistent-idempotency";
import { lockActiveWorkspaceForWrite } from "./exam-workspace-service";
import type { MistakeAttemptDto } from "./types";

export interface CreateMistakeAttemptInput {
  idempotencyKey: string;
  answerMode: "TEXT" | "PAPER_OR_ORAL";
  answerText?: string | null;
  result: "PASSED" | "PARTIAL" | "FAILED";
  durationSeconds?: number | null;
  note?: string | null;
}

export async function createMistakeAttempt(
  id: string,
  input: CreateMistakeAttemptInput,
  actorId: string,
): Promise<MistakeAttemptDto> {
  return prisma.$transaction(async (tx) => {
    const workspace = await lockActiveWorkspaceForWrite(tx, actorId);
    return persistMistakeAttemptInTx(tx, actorId, workspace.id, id, input, null);
  });
}

export async function persistMistakeAttemptInTx(
  tx: Prisma.TransactionClient,
  actorId: string,
  workspaceId: string,
  mistakeId: string,
  input: CreateMistakeAttemptInput,
  reviewEventId: string | null,
): Promise<MistakeAttemptDto> {
  const mistake = await tx.mistake.findFirst({
    where: { id: mistakeId, subject: { workspaceId } },
    select: { id: true, archivedAt: true },
  });
  if (!mistake) throw new ApiError("MISTAKE_NOT_FOUND", 404);
  if (mistake.archivedAt) throw new ApiError("MISTAKE_ARCHIVED", 409);
  if (input.answerMode === "TEXT" && !input.answerText?.trim()) throw new ApiError("MISTAKE_ATTEMPT_ANSWER_REQUIRED", 400);

  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = buildPersistentCreateFingerprint("mistake-attempt-v1", {
    mistakeId,
    reviewEventId,
    answerMode: input.answerMode,
    answerText: input.answerText?.trim() || null,
    result: input.result,
    durationSeconds: input.durationSeconds ?? null,
    note: input.note?.trim() || null,
  });
  const createId = randomUUID();
  const created = await tx.mistakeAttempt.upsert({
    where: { mistakeId_idempotencyKey: { mistakeId, idempotencyKey } },
    update: {},
    create: {
      id: createId,
      mistakeId,
      reviewEventId,
      idempotencyKey,
      requestFingerprint,
      answerMode: input.answerMode,
      answerText: input.answerText?.trim() || null,
      result: input.result,
      durationSeconds: input.durationSeconds ?? null,
      note: input.note?.trim() || null,
      actorId,
    },
  });
  if (created.requestFingerprint !== requestFingerprint) {
    throw new ApiError("MISTAKE_ATTEMPT_IDEMPOTENCY_CONFLICT", 409, { conflictFields: ["idempotencyKey", "requestFingerprint"] });
  }
  if (created.id !== createId) return serializeMistakeAttempt(created);
  await tx.auditEvent.create({ data: { actorId, action: "MISTAKE_ATTEMPT_CREATED", entityType: "MistakeAttempt", entityId: created.id } });
  return serializeMistakeAttempt(created);
}

export function serializeMistakeAttempt(attempt: {
  id: string;
  reviewEventId: string | null;
  answerMode: string;
  answerText: string | null;
  result: string;
  durationSeconds: number | null;
  note: string | null;
  attemptedAt: Date;
}): MistakeAttemptDto {
  return {
    id: attempt.id,
    reviewEventId: attempt.reviewEventId,
    answerMode: attempt.answerMode as MistakeAttemptDto["answerMode"],
    answerText: attempt.answerText,
    result: attempt.result as MistakeAttemptDto["result"],
    durationSeconds: attempt.durationSeconds,
    note: attempt.note,
    attemptedAt: attempt.attemptedAt.toISOString(),
  };
}
