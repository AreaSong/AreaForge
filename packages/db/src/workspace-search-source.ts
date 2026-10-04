import { WORKSPACE_SEARCH_KINDS, SEARCH_INDEX_MAX_DOCUMENTS, SEARCH_INDEX_MAX_TITLE_BYTES, SEARCH_INDEX_MAX_TOTAL_BYTES,
  WorkspaceSearchError, type WorkspaceSearchKind } from "@areaforge/core";
import { Prisma } from "../generated/prisma/client";
import { assertSearchScopeTime, searchHash, searchVisibleSql, type SearchScope } from "./workspace-search-scope";

export const searchSources = {
  SUBJECT: { model: "Subject", field: "subjectId", title: "name", owner: null, subject: false },
  TASK: { model: "StudyTask", field: "taskId", title: "title", owner: "ownerUserId", subject: true },
  KNOWLEDGE_POINT: { model: "KnowledgePoint", field: "knowledgePointId", title: "title", owner: "userId", subject: false },
  NOTE: { model: "Note", field: "noteId", title: "title", owner: "ownerUserId", subject: true },
  MISTAKE: { model: "Mistake", field: "mistakeId", title: "title", owner: "ownerUserId", subject: true },
  RESOURCE: { model: "StudyResource", field: "resourceId", title: "title", owner: "ownerUserId", subject: false },
} as const;

export interface SearchSourceRow {
  id: string; kind: WorkspaceSearchKind; ownerUserId: string; revision: string; parentRevision: string | null;
  updatedAt: Date; sortOrder: number; titleBytes: number; title?: string;
  authorizationExpiresAt?: Date | null;
  authorizationGrantId?: string | null;
}
export interface SearchSnapshot { scope: SearchScope; rows: SearchSourceRow[]; fingerprint: string }

/** 查询前完成 owner/grant/归档/冻结过滤；metadata 模式不读取任何标题或正文。 */
export async function searchSourceRows(tx: Prisma.TransactionClient, scope: SearchScope, kind: WorkspaceSearchKind,
  options: { take: number; titles: boolean; query?: string }): Promise<SearchSourceRow[]> {
  const source = searchSources[kind];
  const join = source.subject ? Prisma.sql`JOIN "Subject" p ON p.id=s."subjectId"` : Prisma.empty;
  const workspace = source.subject ? Prisma.sql`p."workspaceId"` : Prisma.sql`s."workspaceId"`;
  const owner = source.owner ? Prisma.raw(`s."${source.owner}"`) : Prisma.sql`${scope.ownerUserId}::text`;
  const title = Prisma.raw(`s."${source.title}"`);
  const directGrant = scope.sourceOnly && (kind === "NOTE" || kind === "MISTAKE");
  const ownerFilter = kind === "SUBJECT" ? Prisma.sql`TRUE` : Prisma.sql`(${owner}=${scope.actorId} OR ${directGrant ? Prisma.sql`search_grant.id IS NOT NULL` : sharedSource(scope, kind)})`;
  const archived = kind === "TASK" ? Prisma.empty : Prisma.sql`AND s."archivedAt" IS NULL`;
  const order = options.query === undefined ? Prisma.sql`s.id` : kind === "SUBJECT" ? Prisma.sql`s."sortOrder",s.id` : Prisma.sql`s."updatedAt" DESC,s.id`;
  const rows = await tx.$queryRaw<Omit<SearchSourceRow, "kind">[]>(Prisma.sql`
    ${directGrant ? directSearchGrants(scope, kind) : Prisma.empty}
    SELECT s.id,${owner} AS "ownerUserId",s.xmin::text AS revision,${source.subject ? Prisma.sql`p.xmin::text` : Prisma.sql`NULL::text`} AS "parentRevision",
      s."updatedAt",${kind === "SUBJECT" ? Prisma.sql`s."sortOrder"` : Prisma.sql`0`} AS "sortOrder",octet_length(${title}) AS "titleBytes"
      ${options.titles ? Prisma.sql`,${scope.sourceOnly ? Prisma.sql`left(btrim(${title}),240)` : title} AS title` : Prisma.empty}
      ${directGrant ? Prisma.sql`,search_grant.id AS "authorizationGrantId",search_grant."expiresAt" AS "authorizationExpiresAt"` : Prisma.empty}
    FROM ${Prisma.raw(`"${source.model}"`)} s ${join}
      ${directGrant ? Prisma.sql`LEFT JOIN search_grants search_grant ON search_grant."resourceId"=s.id AND search_grant."resourceOwnerUserId"=${owner}` : Prisma.empty}
    WHERE ${workspace}=${scope.workspaceId} AND ${ownerFilter} ${archived}
      ${source.subject ? Prisma.sql`AND p."archivedAt" IS NULL` : Prisma.empty}
      AND ${searchVisibleSql(scope.visibility, source.model, Prisma.sql`s.id`)}
      ${source.subject ? Prisma.sql`AND ${searchVisibleSql(scope.visibility, "Subject", Prisma.sql`p.id`)}` : Prisma.empty}
      ${options.query === undefined ? Prisma.empty : Prisma.sql`AND ${title} ILIKE ${`%${options.query}%`}`}
    ORDER BY ${order} LIMIT ${options.take}`);
  const grantIds = [...new Set(rows.flatMap(row => row.authorizationGrantId ? [row.authorizationGrantId] : []))];
  if (grantIds.length) {
    // 在过滤/排序/分页之后锁最终候选；Serializable 会拒绝快照读取与加锁之间的撤权。
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "WorkspaceShareGrant" WHERE id IN (${Prisma.join(grantIds)}) ORDER BY id FOR SHARE NOWAIT`;
    if (locked.length !== grantIds.length) throw new WorkspaceSearchError("SEARCH_INDEX_AUTHORIZATION_CHANGED", true);
  }
  for (const row of rows) {
    if (row.authorizationExpiresAt && (!scope.validUntil || row.authorizationExpiresAt < scope.validUntil)) scope.validUntil = row.authorizationExpiresAt;
  }
  return rows.map(row => ({ ...row, kind }));
}

/** 授权集合只在 DB 内计算一次，避免新库统计信息不足时逐候选重扫万条 grant。 */
function directSearchGrants(scope: SearchScope, kind: WorkspaceSearchKind): Prisma.Sql {
  return Prisma.sql`WITH search_grants AS MATERIALIZED (
    SELECT DISTINCT ON (g."resourceId",g."resourceOwnerUserId") g.id,g."resourceId",g."resourceOwnerUserId",g."expiresAt"
    FROM "WorkspaceShareGrant" g
    WHERE g."resourceOwnerUserId"<>${scope.actorId} AND g."workspaceId"=${scope.workspaceId} AND g."resourceType"=${kind}
      AND g."revokedAt" IS NULL
      AND (g."expiresAt" IS NULL OR g."expiresAt">clock_timestamp())
      AND ((g.scope='USER' AND g."granteeUserId"=${scope.actorId} AND g."granteeRole" IS NULL)
        OR (g.scope='ROLE' AND g."granteeUserId" IS NULL AND g."granteeRole"::text=${scope.role})
        OR (g.scope='WORKSPACE' AND g.access='VIEW' AND g."granteeUserId" IS NULL AND g."granteeRole" IS NULL))
      AND ${searchVisibleSql(scope.visibility, "WorkspaceShareGrant", Prisma.sql`g.id`)}
      AND ${searchVisibleSql(scope.visibility, "User", Prisma.sql`g."resourceOwnerUserId"`)}
    ORDER BY g."resourceId",g."resourceOwnerUserId",g."expiresAt" DESC NULLS FIRST,g.id)`;
}

function sharedSource(scope: SearchScope, kind: WorkspaceSearchKind): Prisma.Sql {
  if (kind !== "NOTE" && kind !== "MISTAKE") return Prisma.sql`FALSE`;
  const ids = scope.grants.filter(grant => grant.resourceType === kind).map(grant => grant.id);
  return ids.length ? Prisma.sql`EXISTS (SELECT 1 FROM "WorkspaceShareGrant" g WHERE g.id IN (${Prisma.join(ids)})
    AND g."resourceId"=s.id AND g."resourceOwnerUserId"=s."ownerUserId")` : Prisma.sql`FALSE`;
}

export async function captureSearchSources(tx: Prisma.TransactionClient, scope: SearchScope, titles = false): Promise<SearchSnapshot> {
  const rows: SearchSourceRow[] = []; let bytes = 0;
  for (const kind of WORKSPACE_SEARCH_KINDS) {
    rows.push(...await searchSourceRows(tx, scope, kind, { take: SEARCH_INDEX_MAX_DOCUMENTS - rows.length + 1, titles: false }));
    if (rows.length > SEARCH_INDEX_MAX_DOCUMENTS) throw new WorkspaceSearchError("SEARCH_INDEX_DOCUMENT_LIMIT");
  }
  if (titles) {
    for (const row of rows) {
      bytes += row.titleBytes;
      if (row.titleBytes > SEARCH_INDEX_MAX_TITLE_BYTES || bytes > SEARCH_INDEX_MAX_TOTAL_BYTES) throw new WorkspaceSearchError("SEARCH_INDEX_TITLE_LIMIT");
    }
    // 先在数据库侧取得字节数并拒绝超限，随后才把标题复制到进程内。
    const full: SearchSourceRow[] = [];
    for (const kind of WORKSPACE_SEARCH_KINDS) full.push(...await searchSourceRows(tx, scope, kind, { take: SEARCH_INDEX_MAX_DOCUMENTS + 1, titles: true }));
    if (searchHash("source-rows", full.map(searchSourceBinding)) !== searchHash("source-rows", rows.map(searchSourceBinding))) throw new WorkspaceSearchError("SEARCH_INDEX_SNAPSHOT_CHANGED");
    rows.splice(0, rows.length, ...full);
  }
  await assertSearchScopeTime(tx, scope);
  return { scope, rows, fingerprint: searchHash("sources", { authority: scope.fingerprint, rows: rows.map(searchSourceBinding) }) };
}

export function searchSourceBinding(row: SearchSourceRow) {
  return { id: row.id, kind: row.kind, ownerUserId: row.ownerUserId, revision: row.revision,
    parentRevision: row.parentRevision, updatedAt: row.updatedAt.toISOString(), sortOrder: row.sortOrder };
}

export function searchSourceRevision(row: SearchSourceRow): string { return searchHash("row", searchSourceBinding(row)); }

export interface SearchResult { id: string; kind: WorkspaceSearchKind; label: string; href: string; visibility: "OWNER" | "SHARED" | "WORKSPACE" }
export function searchResult(row: Pick<SearchSourceRow, "id" | "kind" | "title" | "ownerUserId">, actorId: string): SearchResult {
  const roots: Record<WorkspaceSearchKind, string> = { SUBJECT: "/settings/exams", TASK: "/roadmap/allocation/tasks/", KNOWLEDGE_POINT: "/knowledge/points/",
    NOTE: "/knowledge/cards/", MISTAKE: "/knowledge/mistakes/", RESOURCE: "/knowledge/resources/" };
  return { id: row.id, kind: row.kind, label: row.title?.trim().slice(0, 240) || "未命名对象",
    href: roots[row.kind] + (row.kind === "SUBJECT" ? "" : encodeURIComponent(row.id)),
    visibility: row.kind === "SUBJECT" ? "WORKSPACE" : row.ownerUserId === actorId ? "OWNER" : "SHARED" };
}

export function sortSearchResults(rows: SearchResult[], query: string): SearchResult[] {
  const normalized = query.toLocaleLowerCase();
  return rows.sort((a, b) => Number(b.label.toLocaleLowerCase() === normalized) - Number(a.label.toLocaleLowerCase() === normalized)
    || a.label.toLocaleLowerCase().localeCompare(b.label.toLocaleLowerCase(), "zh-CN") || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}
