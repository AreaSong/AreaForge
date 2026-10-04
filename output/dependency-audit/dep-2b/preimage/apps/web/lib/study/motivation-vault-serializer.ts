import type { Prisma } from "@areaforge/db";
import type { MotivationVaultDto } from "@/lib/contracts";

export interface SerializableMotivationVaultRecord {
  id: string;
  whyStarted: string | null;
  neverReturnTo: string | null;
  futureSelf: string | null;
  messageToFuture: string | null;
  firstSimulationDiary: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function serializeMotivationVault(vault: SerializableMotivationVaultRecord): MotivationVaultDto {
  return {
    id: vault.id,
    whyStarted: vault.whyStarted,
    neverReturnTo: vault.neverReturnTo,
    futureSelf: vault.futureSelf,
    messageToFuture: vault.messageToFuture,
    firstSimulationDiary: vault.firstSimulationDiary,
    createdAt: vault.createdAt.toISOString(),
    updatedAt: vault.updatedAt.toISOString(),
  };
}

export function parseMotivationVaultSnapshot(value: Prisma.JsonValue | undefined): MotivationVaultDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  if (
    typeof snapshot.id !== "string" ||
    typeof snapshot.createdAt !== "string" ||
    typeof snapshot.updatedAt !== "string"
  ) return null;
  const nullableFields = ["whyStarted", "neverReturnTo", "futureSelf", "messageToFuture", "firstSimulationDiary"];
  if (!nullableFields.every((field) => snapshot[field] === null || typeof snapshot[field] === "string")) return null;
  return snapshot as unknown as MotivationVaultDto;
}
