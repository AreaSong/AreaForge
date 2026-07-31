import { createHash } from "node:crypto";
import { stableStringify } from "@areaforge/core";
import type { Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";

const persistentCreateProtocol = "audit-event-create-v1";
const persistentCreateLockNamespace = 8211;

export interface PersistentCreateCommand {
  actorId: string;
  workspaceId: string;
  action: string;
  entityType: string;
  idempotencyKey: string;
  requestFingerprint: string;
  conflictCode: string;
  pendingLeaseMs?: number;
}

export type PersistentCreateReplay = {
  resultId: string;
  resultSnapshot?: Prisma.JsonValue;
};

export type PersistentCreateClaim =
  | { state: "claimed"; claimEventId: string }
  | { state: "pending" }
  | { state: "replayed"; replay: PersistentCreateReplay };

export function buildPersistentCreateFingerprint(command: string, payload: unknown): string {
  return createHash("sha256")
    .update(stableStringify({ command, payload }))
    .digest("hex");
}

export function normalizeIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 200) {
    throw new ApiError("INVALID_IDEMPOTENCY_KEY", 400);
  }
  return normalized;
}

export async function findPersistentCreateResultId(
  tx: Prisma.TransactionClient,
  command: PersistentCreateCommand,
): Promise<string | null> {
  return (await findPersistentCreateReplay(tx, command))?.resultId ?? null;
}

export async function findPersistentCreateReplay(
  tx: Prisma.TransactionClient,
  command: PersistentCreateCommand,
): Promise<PersistentCreateReplay | null> {
  await lockPersistentCreateCommand(tx, command);
  const event = await findPersistentCreateEvent(tx, command);
  if (!event) return null;
  return replayFromPersistentEvent(event, command);
}

export async function claimPersistentCreateCommand(
  tx: Prisma.TransactionClient,
  command: PersistentCreateCommand,
): Promise<PersistentCreateClaim> {
  await lockPersistentCreateCommand(tx, command);
  const event = await findPersistentCreateEvent(tx, command);
  if (event) {
    const metadata = assertPersistentFingerprint(event.metadata, command);
    if (metadata.claimState === "pending") {
      if (!canTakeOverPendingClaim(event.createdAt, metadata, command.pendingLeaseMs)) {
        return { state: "pending" };
      }
      const claimAttempt = typeof metadata.claimAttempt === "number" && Number.isInteger(metadata.claimAttempt)
        ? metadata.claimAttempt + 1
        : 2;
      await tx.auditEvent.update({
        where: { id: event.id },
        data: {
          metadata: {
            ...metadata,
            claimStartedAt: new Date().toISOString(),
            claimAttempt,
          } as Prisma.InputJsonObject,
        },
      });
      return { state: "claimed", claimEventId: event.id };
    }
    return { state: "replayed", replay: replayFromPersistentEvent(event, command) };
  }

  const claim = await tx.auditEvent.create({
    data: {
      actorId: command.actorId,
      action: command.action,
      entityType: command.entityType,
      metadata: {
        idempotencyProtocol: persistentCreateProtocol,
        claimState: "pending",
        workspaceId: command.workspaceId,
        idempotencyKey: command.idempotencyKey,
        requestFingerprint: command.requestFingerprint,
        claimStartedAt: new Date().toISOString(),
        claimAttempt: 1,
      },
    },
    select: { id: true },
  });
  return { state: "claimed", claimEventId: claim.id };
}

export async function completePersistentCreateClaim(
  tx: Prisma.TransactionClient,
  command: PersistentCreateCommand,
  claimEventId: string,
  resultId: string,
  metadata: Prisma.InputJsonObject = {},
  resultSnapshot?: Prisma.InputJsonValue,
): Promise<void> {
  await lockPersistentCreateCommand(tx, command);
  const claim = await tx.auditEvent.findFirst({
    where: {
      id: claimEventId,
      actorId: command.actorId,
      action: command.action,
      entityType: command.entityType,
    },
    select: { metadata: true },
  });
  if (!claim) throw new ApiError(`${command.conflictCode}_CLAIM_UNAVAILABLE`, 409);
  const claimMetadata = assertPersistentFingerprint(claim.metadata, command);
  if (claimMetadata.claimState !== "pending") {
    throw new ApiError(`${command.conflictCode}_CLAIM_COMPLETED`, 409, {
      conflictFields: ["idempotencyKey"],
    });
  }

  await tx.auditEvent.update({
    where: { id: claimEventId },
    data: {
      entityId: resultId,
      metadata: {
        ...metadata,
        idempotencyProtocol: persistentCreateProtocol,
        claimState: "completed",
        workspaceId: command.workspaceId,
        idempotencyKey: command.idempotencyKey,
        requestFingerprint: command.requestFingerprint,
        ...(typeof claimMetadata.claimStartedAt === "string" ? { claimStartedAt: claimMetadata.claimStartedAt } : {}),
        ...(typeof claimMetadata.claimAttempt === "number" ? { claimAttempt: claimMetadata.claimAttempt } : {}),
        resultId,
        ...(resultSnapshot === undefined ? {} : { resultSnapshot }),
      },
    },
  });
}

export async function recordPersistentCreateResult(
  tx: Prisma.TransactionClient,
  command: PersistentCreateCommand,
  resultId: string,
  metadata: Prisma.InputJsonObject = {},
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      actorId: command.actorId,
      action: command.action,
      entityType: command.entityType,
      entityId: resultId,
      metadata: {
        ...metadata,
        idempotencyProtocol: persistentCreateProtocol,
        workspaceId: command.workspaceId,
        idempotencyKey: command.idempotencyKey,
        requestFingerprint: command.requestFingerprint,
        resultId,
      },
    },
  });
}

function asRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function lockPersistentCreateCommand(
  tx: Prisma.TransactionClient,
  command: PersistentCreateCommand,
): Promise<void> {
  const lockScope = [
    command.actorId,
    command.workspaceId,
    command.action,
    command.entityType,
    command.idempotencyKey,
  ].join(":");
  await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${persistentCreateLockNamespace}, hashtext(${lockScope}))`;
}

async function findPersistentCreateEvent(
  tx: Prisma.TransactionClient,
  command: PersistentCreateCommand,
) {
  return tx.auditEvent.findFirst({
    where: {
      actorId: command.actorId,
      action: command.action,
      entityType: command.entityType,
      AND: [
        { metadata: { path: ["workspaceId"], equals: command.workspaceId } },
        { metadata: { path: ["idempotencyKey"], equals: command.idempotencyKey } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
}

function assertPersistentFingerprint(
  value: Prisma.JsonValue | null,
  command: PersistentCreateCommand,
): Record<string, unknown> {
  const metadata = asRecord(value);
  if (metadata.requestFingerprint !== command.requestFingerprint) {
    throw new ApiError(command.conflictCode, 409, {
      conflictFields: ["idempotencyKey", "requestFingerprint"],
    });
  }
  return metadata;
}

function replayFromPersistentEvent(
  event: { entityId: string | null; metadata: Prisma.JsonValue | null },
  command: PersistentCreateCommand,
): PersistentCreateReplay {
  const metadata = assertPersistentFingerprint(event.metadata, command);
  if (metadata.claimState === "pending") {
    throw new ApiError(`${command.conflictCode}_IN_PROGRESS`, 409, {
      latest: { state: "pending" },
      conflictFields: ["idempotencyKey"],
    });
  }
  const resultId = typeof metadata.resultId === "string" ? metadata.resultId : event.entityId;
  if (!resultId) {
    throw new ApiError(`${command.conflictCode}_RESULT_UNAVAILABLE`, 409, {
      conflictFields: ["idempotencyKey"],
    });
  }
  return {
    resultId,
    ...(metadata.resultSnapshot !== undefined
      ? { resultSnapshot: metadata.resultSnapshot as Prisma.JsonValue }
      : {}),
  };
}

function canTakeOverPendingClaim(
  createdAt: Date,
  metadata: Record<string, unknown>,
  pendingLeaseMs: number | undefined,
): boolean {
  if (!pendingLeaseMs || !Number.isFinite(pendingLeaseMs) || pendingLeaseMs < 1_000) return false;
  const claimedAt = typeof metadata.claimStartedAt === "string"
    ? Date.parse(metadata.claimStartedAt)
    : createdAt.getTime();
  if (!Number.isFinite(claimedAt)) return false;
  return Date.now() - claimedAt >= pendingLeaseMs;
}
