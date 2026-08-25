import { prisma, type Prisma } from "@areaforge/db";
import { cache } from "react";
import { ApiError } from "@/lib/api/responses";
import {
  buildPersistentCreateFingerprint,
  findPersistentCreateReplay,
  normalizeIdempotencyKey,
  recordPersistentCreateResult,
} from "./persistent-idempotency";
import { parseMotivationVaultSnapshot, serializeMotivationVault } from "./motivation-vault-serializer";
import type { SaveMotivationVaultInput } from "./study-service-contracts";
import type { MotivationVaultDto } from "@/lib/contracts";

export async function getMotivationVault(): Promise<MotivationVaultDto | null> {
  const vault = await prisma.motivationVault.findFirst({ orderBy: { createdAt: "asc" } });
  return vault ? serializeMotivationVault(vault) : null;
}

export const getMotivationVaultShared = cache(async (): Promise<MotivationVaultDto | null> => getMotivationVault());

export async function saveMotivationVault(
  input: SaveMotivationVaultInput,
  actorId: string,
): Promise<MotivationVaultDto> {
  const data = {
    whyStarted: normalizeOptionalText(input.whyStarted),
    neverReturnTo: normalizeOptionalText(input.neverReturnTo),
    futureSelf: normalizeOptionalText(input.futureSelf),
    messageToFuture: normalizeOptionalText(input.messageToFuture),
    firstSimulationDiary: normalizeOptionalText(input.firstSimulationDiary),
  };
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const requestFingerprint = buildPersistentCreateFingerprint("motivation-vault-save-v2", {
    expectedUpdatedAt: input.expectedUpdatedAt,
    data,
  });

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(8197, 1101)`;
    const command = {
      actorId,
      workspaceId: `user-global:${actorId}`,
      action: "MOTIVATION_VAULT_SAVED",
      entityType: "MotivationVault",
      idempotencyKey,
      requestFingerprint,
      conflictCode: "MOTIVATION_VAULT_IDEMPOTENCY_CONFLICT",
    } as const;
    const replay = await findPersistentCreateReplay(tx, command);
    if (replay) {
      const snapshot = parseMotivationVaultSnapshot(replay.resultSnapshot);
      if (snapshot) return snapshot;
      const existingResult = await tx.motivationVault.findUnique({ where: { id: replay.resultId } });
      if (!existingResult) throw new ApiError("MOTIVATION_VAULT_IDEMPOTENCY_RESULT_NOT_FOUND", 409);
      return serializeMotivationVault(existingResult);
    }

    const existing = await tx.motivationVault.findFirst({ orderBy: { createdAt: "asc" } });
    const currentUpdatedAt = existing?.updatedAt.toISOString() ?? null;
    if (currentUpdatedAt !== input.expectedUpdatedAt) {
      throw new ApiError("MOTIVATION_VAULT_REVISION_CONFLICT", 409, {
        latest: existing ? serializeMotivationVault(existing) : null,
        conflictFields: collectMotivationVaultConflictFields(input, existing ? serializeMotivationVault(existing) : null),
        workbench: "/settings/profile",
      });
    }
    const vault = existing
      ? await tx.motivationVault.update({ where: { id: existing.id }, data })
      : await tx.motivationVault.create({ data });
    const result = serializeMotivationVault(vault);
    await recordPersistentCreateResult(tx, command, vault.id, {
      resultSnapshot: result as unknown as Prisma.InputJsonObject,
    });
    return result;
  });
}

function collectMotivationVaultConflictFields(
  input: SaveMotivationVaultInput,
  latest: MotivationVaultDto | null,
): string[] {
  const fields = ["updatedAt"];
  if (!latest) return fields;
  const values: Array<[keyof SaveMotivationVaultInput, string | null]> = [
    ["whyStarted", latest.whyStarted],
    ["neverReturnTo", latest.neverReturnTo],
    ["futureSelf", latest.futureSelf],
    ["messageToFuture", latest.messageToFuture],
    ["firstSimulationDiary", latest.firstSimulationDiary],
  ];
  for (const [field, serverValue] of values) {
    if (input[field] !== undefined && normalizeOptionalText(input[field] as string | undefined) !== serverValue) fields.push(field);
  }
  return fields;
}

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized.slice(0, 4000) : null;
}
