import { normalizeAuditSearchQuery, type AuditSearchQuery } from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import type { CurrentUser } from "@/lib/auth/session";
import { requirePlatformOperator } from "./operator-policy";

type AuditSearchClient = Pick<Prisma.TransactionClient, "auditEvent">;

export interface AuditEventDto {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
  createdAt: string;
}

const SAFE_METADATA_KEYS = new Set([
  "workspaceId", "status", "fromStatus", "toStatus", "authRevision", "revision", "kind", "scope",
  "risk", "operationCode", "resultCode", "errorCode", "resourceType", "access", "role", "enabled",
  "attempt", "progress", "sourceType", "targetType", "entityType", "eventVersion", "revokedSessionCount",
  "publishedFieldCount", "rulesVersion", "scoreVersion",
]);

export async function listAuditEvents(
  actor: CurrentUser,
  input: Partial<AuditSearchQuery> = {},
  client: AuditSearchClient = prisma,
): Promise<AuditEventDto[]> {
  await requirePlatformOperator(actor);
  let query: AuditSearchQuery;
  try {
    query = normalizeAuditSearchQuery(input);
  } catch {
    throw new ApiError("AUDIT_QUERY_INVALID", 400);
  }

  const where: Prisma.AuditEventWhereInput = {
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.actionPrefix ? { action: { startsWith: query.actionPrefix } } : {}),
    ...(query.workspaceId ? { metadata: { path: ["workspaceId"], equals: query.workspaceId } } : {}),
    ...(query.from || query.to ? {
      createdAt: {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lt: new Date(query.to) } : {}),
      },
    } : {}),
  };
  const rows = await client.auditEvent.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit,
    select: { id: true, actorId: true, action: true, entityType: true, entityId: true, metadata: true, createdAt: true },
  });
  return rows.map(serializeAuditEvent);
}

export function serializeAuditEvent(row: {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: Date;
}): AuditEventDto {
  return {
    id: row.id,
    actorId: row.actorId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: summarizeAuditMetadata(row.metadata),
    createdAt: row.createdAt.toISOString(),
  };
}

export function summarizeAuditMetadata(value: unknown): Readonly<Record<string, string | number | boolean | null>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!SAFE_METADATA_KEYS.has(key) || Object.keys(result).length >= 20) continue;
    if (item === null || typeof item === "boolean") {
      result[key] = item;
    } else if (typeof item === "number" && Number.isFinite(item)) {
      result[key] = item;
    } else if (typeof item === "string" && item.length <= 191 && !/[\r\n]/.test(item)) {
      result[key] = item;
    }
  }
  return result;
}
