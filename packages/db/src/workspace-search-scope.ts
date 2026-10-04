import { createHash } from "node:crypto";
import { hasWorkspaceCapability, searchIdentifier, stableStringify, workspaceGrantAllowsActor, WorkspaceSearchError,
  type ActiveWorkspaceGrant, type WorkspaceRole } from "@areaforge/core";
import { Prisma } from "../generated/prisma/client";
import { guardDerivedQueueTransaction, isDataJobScopeBusy } from "./data-job-derived-guard";
import { queueClock } from "./data-job-queue-store";

export type SearchEnvironment = Readonly<Record<string, string | undefined>>;
export interface SearchGrant extends ActiveWorkspaceGrant { id: string; revision: number; resourceType: string; resourceId: string; resourceOwnerUserId: string }
export interface SearchVisibility { revision: string; native?: boolean; hidden: (model: string) => string[] }
export interface SearchScope {
  actorId: string; workspaceId: string; ownerUserId: string; role: WorkspaceRole;
  fingerprint: string; grants: SearchGrant[]; visibility: SearchVisibility; validUntil: Date | null; sessionExpiresAt: Date | null;
  sourceOnly: boolean;
}

/** 与资源策略共用 grant 判定；删除屏障和权限行锁覆盖整个读取/发布事务。 */
export async function captureSearchScope(tx: Prisma.TransactionClient, actorId: string, workspaceId: string,
  options: { env: SearchEnvironment; sessionId?: string; sourceOnly?: boolean }): Promise<SearchScope> {
  searchIdentifier(actorId); searchIdentifier(workspaceId);
  await guardDerivedQueueTransaction(tx, ["SEARCH_INDEX_REBUILD"]);
  const visibility = await searchVisibility(tx, options.sourceOnly);
  if (visibility.hidden("User").includes(actorId) || visibility.hidden("ExamWorkspace").includes(workspaceId)) notFound();
  const [user] = await tx.$queryRaw<Array<{ id: string; status: string; authRevision: number }>>`
    SELECT id,status,"authRevision" FROM "User" WHERE id=${actorId}
      AND ${searchVisibleSql(visibility, "User", Prisma.sql`"User".id`)} FOR SHARE NOWAIT`;
  if (user?.status !== "ACTIVE") notFound();
  const sessionExpiresAt = options.sessionId ? await requireSearchSession(tx, actorId, options.sessionId, user.authRevision) : null;
  const [workspace] = await tx.$queryRaw<Array<{ id: string; userId: string; status: string; revision: number }>>`
    SELECT id,"userId",status,revision FROM "ExamWorkspace" WHERE id=${workspaceId}
      AND ${searchVisibleSql(visibility, "ExamWorkspace", Prisma.sql`"ExamWorkspace".id`)} FOR SHARE NOWAIT`;
  if (workspace?.status !== "ACTIVE") notFound();
  const membership = await searchMembership(tx, actorId, workspace, visibility, options.env);
  const role = membership?.role ?? "OWNER";
  const now = await queueClock(tx);
  const grants = options.sourceOnly ? [] : await searchGrants(tx, { actorId, workspaceId, role, visibility, now });
  const validUntil = grants.reduce<Date | null>((earliest, grant) => grant.expiresAt && (!earliest || grant.expiresAt < earliest) ? grant.expiresAt : earliest, null);
  return { actorId, workspaceId, ownerUserId: workspace.userId, role, visibility, grants, validUntil, sessionExpiresAt, sourceOnly: options.sourceOnly === true,
    fingerprint: searchHash("authority", { user, workspace, membership, deletionRevision: visibility.revision,
      grants: grants.map(grant => ({ ...grant, expiresAt: grant.expiresAt?.toISOString() ?? null, revokedAt: null })) }) };
}

async function searchMembership(tx: Prisma.TransactionClient, actorId: string, workspace: { id: string; userId: string },
  visibility: SearchVisibility, env: SearchEnvironment) {
  if (env.AUTH_MULTI_USER_ENABLED !== "true" || env.AUTH_RBAC_ENABLED !== "true") {
    if (workspace.userId !== actorId) notFound();
    return null;
  }
  const rows = await tx.$queryRaw<Array<{ id: string; userId: string; status: string; role: WorkspaceRole; revision: number }>>`
    SELECT id,"userId",status,role,revision FROM "WorkspaceMembership"
    WHERE "workspaceId"=${workspace.id} AND ("userId"=${actorId} OR (role='OWNER' AND status='ACTIVE'))
      AND ${searchVisibleSql(visibility, "WorkspaceMembership", Prisma.sql`"WorkspaceMembership".id`)} ORDER BY id LIMIT 3 FOR SHARE NOWAIT`;
  const membership = rows.find(row => row.userId === actorId && !visibility.hidden("WorkspaceMembership").includes(row.id));
  const owners = rows.filter(row => row.role === "OWNER" && row.status === "ACTIVE");
  if (membership?.status !== "ACTIVE" || owners.length !== 1 || owners[0]!.userId !== workspace.userId
    || (membership.role === "OWNER") !== (workspace.userId === actorId) || !hasWorkspaceCapability(membership.role, "workspace:read")) notFound();
  return membership;
}

async function searchGrants(tx: Prisma.TransactionClient, input: { actorId: string; workspaceId: string; role: WorkspaceRole; visibility: SearchVisibility; now: Date }) {
  const rows = await tx.$queryRaw<SearchGrant[]>(Prisma.sql`
    SELECT id,revision,"resourceType","resourceId","resourceOwnerUserId",scope,"granteeUserId","granteeRole",access,"expiresAt","revokedAt"
    FROM "WorkspaceShareGrant" WHERE "workspaceId"=${input.workspaceId} AND "revokedAt" IS NULL
      AND ("expiresAt" IS NULL OR "expiresAt">${input.now}) AND "resourceType" IN ('NOTE','MISTAKE')
      AND ((scope='USER' AND "granteeUserId"=${input.actorId}) OR (scope='ROLE' AND "granteeRole"::text=${input.role}) OR scope='WORKSPACE')
    ORDER BY id LIMIT 10001 FOR SHARE NOWAIT`);
  if (rows.length > 10000) throw new WorkspaceSearchError("SEARCH_INDEX_GRANT_LIMIT");
  return rows.filter(grant => !input.visibility.hidden("WorkspaceShareGrant").includes(grant.id)
    && !input.visibility.hidden("User").includes(grant.resourceOwnerUserId) && workspaceGrantAllowsActor(grant, input, "VIEW", input.now));
}

export async function searchVisibility(tx: Prisma.TransactionClient, sourceOnly = false): Promise<SearchVisibility> {
  const [available] = await tx.$queryRaw<Array<{ ready: boolean }>>`SELECT to_regclass('"DataDeletionVisibility"') IS NOT NULL AS ready`;
  if (!available?.ready) return { revision: "legacy", hidden: () => [] };
  const epoch = await tx.dataDeletionVisibility.findUnique({ where: { id: 1 }, select: { revision: true } });
  if (!epoch) throw new WorkspaceSearchError("SEARCH_INDEX_VISIBILITY_UNAVAILABLE");
  // 直查按候选行在 SQL 内过滤，不把全库冻结记录或全分区 grant 上限变成学习搜索配额。
  if (sourceOnly) return { revision: epoch.revision.toString(), native: true, hidden: () => [] };
  const rows = await tx.dataDeletionFence.findMany({ where: { model: { in: ["User", "AuthSession", "ExamWorkspace", "WorkspaceMembership",
    "WorkspaceShareGrant", "Subject", "StudyTask", "KnowledgePoint", "Note", "Mistake", "StudyResource", "WorkspaceSearchPartition", "WorkspaceSearchDocument", "DataJob"] } },
  select: { model: true, keyJson: true }, take: 20001 });
  if (rows.length > 20000) throw new WorkspaceSearchError("SEARCH_INDEX_VISIBILITY_LIMIT");
  const hidden = new Map<string, string[]>();
  for (const row of rows) {
    const key = row.keyJson as Record<string, unknown> | null;
    if (!key || Array.isArray(key) || Object.keys(key).length !== 1 || typeof key.id !== "string") throw new WorkspaceSearchError("SEARCH_INDEX_VISIBILITY_INVALID");
    const ids = hidden.get(row.model) ?? []; ids.push(key.id); hidden.set(row.model, ids);
  }
  return { revision: epoch.revision.toString(), hidden: model => hidden.get(model) ?? [] };
}

export function searchVisibleSql(visibility: SearchVisibility, model: string, id: Prisma.Sql): Prisma.Sql {
  if (visibility.revision === "legacy") return Prisma.sql`TRUE`;
  if (visibility.native) return Prisma.sql`NOT EXISTS (SELECT 1 FROM "DataDeletionFence" search_fence
    WHERE search_fence.model=${model} AND search_fence."keyJson"->>'id'=(${id}))`;
  const hidden = visibility.hidden(model);
  return hidden.length ? Prisma.sql`(${id}) NOT IN (${Prisma.join(hidden)})` : Prisma.sql`TRUE`;
}

export async function requireSearchSession(tx: Prisma.TransactionClient, actorId: string, sessionId: string, authRevision: number) {
  searchIdentifier(sessionId);
  const [session] = await tx.$queryRaw<Array<{ userId: string; authRevision: number; revokedAt: Date | null; expiresAt: Date }>>`
    SELECT "userId","authRevision","revokedAt","expiresAt" FROM "AuthSession" WHERE id=${sessionId} FOR SHARE NOWAIT`;
  if (!session || session.userId !== actorId || session.authRevision !== authRevision || session.revokedAt || session.expiresAt <= await queueClock(tx)) {
    throw new WorkspaceSearchError("SEARCH_INDEX_SESSION_REVOKED");
  }
  return session.expiresAt;
}

export async function assertSearchScopeTime(tx: Prisma.TransactionClient, scope: SearchScope): Promise<void> {
  const now = await queueClock(tx);
  if (scope.sessionExpiresAt && scope.sessionExpiresAt <= now) throw new WorkspaceSearchError("SEARCH_INDEX_SESSION_REVOKED");
  if (scope.validUntil && scope.validUntil <= now) throw new WorkspaceSearchError("SEARCH_INDEX_AUTHORIZATION_EXPIRED", true);
}

export function searchHash(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256").update(`areaforge:workspace-search:${domain}:v1\n${stableStringify(value)}`).digest("hex")}`;
}
export function searchDatabaseError(error: unknown): never {
  if (error instanceof WorkspaceSearchError) throw error;
  if (isDataJobScopeBusy(error)) throw new WorkspaceSearchError("SEARCH_INDEX_SCOPE_BUSY", true);
  throw error;
}
function notFound(): never { throw new WorkspaceSearchError("SEARCH_INDEX_NOT_FOUND"); }
