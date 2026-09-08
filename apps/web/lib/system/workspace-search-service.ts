import { filterWorkspaceSearchCandidates, listWorkspaceCapabilities, type WorkspaceSearchCandidate } from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getAuthEnv } from "@/lib/auth/env";
import type { WorkspaceSearchResponseDto, WorkspaceSearchResultKind } from "@/lib/contracts/search";
import { requireWorkspaceOwner } from "@/lib/workspace/access-service";
import { grantAllowsActor, requireWorkspacePolicy, type WorkspacePolicyContext } from "@/lib/workspace/policy-service";

interface SearchRow extends WorkspaceSearchCandidate {
  kind: WorkspaceSearchResultKind;
  label: string;
  href: string;
}

export async function searchWorkspace(
  actorId: string,
  workspaceIdInput: string,
  queryInput: string,
  limitInput = 30,
  now = new Date(),
): Promise<WorkspaceSearchResponseDto> {
  const workspaceId = opaque(workspaceIdInput, "workspaceId");
  const query = normalizeQuery(queryInput);
  const limit = normalizeLimit(limitInput);
  if (!Number.isFinite(now.getTime())) throw new ApiError("WORKSPACE_SEARCH_QUERY_INVALID", 400);
  const context = await resolveSearchContext(actorId, workspaceId);
  const grants = await prisma.workspaceShareGrant.findMany({
    where: {
      workspaceId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      resourceType: { in: ["NOTE", "MISTAKE"] },
    },
    select: {
      resourceType: true, resourceId: true, resourceOwnerUserId: true, scope: true,
      granteeUserId: true, granteeRole: true, access: true, revokedAt: true, expiresAt: true,
    },
  });
  const visibleGrantIds = new Map<"NOTE" | "MISTAKE", Set<string>>([
    ["NOTE", new Set()], ["MISTAKE", new Set()],
  ]);
  for (const grant of grants) {
    if ((grant.resourceType === "NOTE" || grant.resourceType === "MISTAKE")
      && grantAllowsActor(grant, context, "VIEW")) {
      visibleGrantIds.get(grant.resourceType)?.add(grant.resourceId);
    }
  }
  const noteIds = [...visibleGrantIds.get("NOTE")!];
  const mistakeIds = [...visibleGrantIds.get("MISTAKE")!];
  const take = Math.min(limit + 1, 101);
  const [subjects, tasks, points, notes, mistakes, resources] = await Promise.all([
    prisma.subject.findMany({
      where: { workspaceId, archivedAt: null, name: { contains: query, mode: "insensitive" } },
      select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], take,
    }),
    prisma.studyTask.findMany({
      where: { ownerUserId: actorId, subject: { workspaceId, archivedAt: null }, title: { contains: query, mode: "insensitive" } },
      select: { id: true, title: true, ownerUserId: true }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take,
    }),
    prisma.knowledgePoint.findMany({
      where: { userId: actorId, workspaceId, archivedAt: null, title: { contains: query, mode: "insensitive" } },
      select: { id: true, title: true, userId: true }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take,
    }),
    prisma.note.findMany({
      where: {
        archivedAt: null, subject: { workspaceId, archivedAt: null }, title: { contains: query, mode: "insensitive" },
        OR: [{ ownerUserId: actorId }, ...(noteIds.length ? [{ id: { in: noteIds } }] : [])],
      },
      select: { id: true, title: true, ownerUserId: true }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take,
    }),
    prisma.mistake.findMany({
      where: {
        archivedAt: null, subject: { workspaceId, archivedAt: null }, title: { contains: query, mode: "insensitive" },
        OR: [{ ownerUserId: actorId }, ...(mistakeIds.length ? [{ id: { in: mistakeIds } }] : [])],
      },
      select: { id: true, title: true, ownerUserId: true }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take,
    }),
    prisma.studyResource.findMany({
      where: { workspaceId, ownerUserId: actorId, archivedAt: null, title: { contains: query, mode: "insensitive" } },
      select: { id: true, title: true, ownerUserId: true }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take,
    }),
  ]);
  const candidates: SearchRow[] = [
    ...subjects.map((row) => candidate(row.id, "SUBJECT", row.name, `/settings/exams`, context.ownerUserId, workspaceId, "WORKSPACE")),
    ...tasks.map((row) => candidate(row.id, "TASK", row.title, `/roadmap/allocation/tasks/${encodeURIComponent(row.id)}`, row.ownerUserId, workspaceId, "OWNER")),
    ...points.map((row) => candidate(row.id, "KNOWLEDGE_POINT", row.title, `/knowledge/points/${encodeURIComponent(row.id)}`, row.userId, workspaceId, "OWNER")),
    ...notes.map((row) => candidate(row.id, "NOTE", row.title, `/knowledge/cards/${encodeURIComponent(row.id)}`, row.ownerUserId, workspaceId, row.ownerUserId === actorId ? "OWNER" : "SHARED", actorId)),
    ...mistakes.map((row) => candidate(row.id, "MISTAKE", row.title, `/knowledge/mistakes/${encodeURIComponent(row.id)}`, row.ownerUserId, workspaceId, row.ownerUserId === actorId ? "OWNER" : "SHARED", actorId)),
    ...resources.map((row) => candidate(row.id, "RESOURCE", row.title, `/knowledge/resources/${encodeURIComponent(row.id)}`, row.ownerUserId, workspaceId, "OWNER")),
  ];
  const visibleCandidates = new Set(filterWorkspaceSearchCandidates({
    actorId, workspaceId, activeWorkspaceIds: [workspaceId], candidates,
  }));
  const visible = candidates
    .filter((row) => visibleCandidates.has(row))
    .sort((a, b) => compareResults(a, b, query));
  return {
    contractVersion: "workspace-search-v1",
    workspaceId,
    query,
    results: visible.slice(0, limit).map(({ id, kind, label, href, visibility }) => ({ id, kind, label, href, visibility })),
    truncated: visible.length > limit || [subjects, tasks, points, notes, mistakes, resources].some((rows) => rows.length > limit),
    indexed: false,
  };
}

function candidate(
  id: string,
  kind: WorkspaceSearchResultKind,
  label: string,
  href: string,
  ownerUserId: string,
  workspaceId: string,
  visibility: SearchRow["visibility"],
  sharedActorId?: string,
): SearchRow {
  const normalizedLabel = label.trim().slice(0, 240);
  return {
    id, kind, label: normalizedLabel || "未命名对象", href, ownerUserId, workspaceId, visibility,
    ...(visibility === "SHARED" && sharedActorId ? { sharedWithUserIds: [sharedActorId] } : {}),
  };
}

async function resolveSearchContext(actorId: string, workspaceId: string): Promise<WorkspacePolicyContext> {
  const env = getAuthEnv();
  if (env.AUTH_MULTI_USER_ENABLED && env.AUTH_RBAC_ENABLED) {
    return requireWorkspacePolicy(prisma, actorId, workspaceId, "workspace:read");
  }
  try {
    const workspace = await requireWorkspaceOwner(prisma, actorId, workspaceId, { active: true });
    return {
      actorId,
      workspaceId,
      ownerUserId: workspace.userId,
      role: "OWNER",
      capabilities: listWorkspaceCapabilities("OWNER"),
    };
  } catch {
    throw new ApiError("WORKSPACE_RESOURCE_NOT_FOUND", 404);
  }
}

function compareResults(a: SearchRow, b: SearchRow, query: string): number {
  const normalizedA = a.label.trim().toLocaleLowerCase();
  const normalizedB = b.label.trim().toLocaleLowerCase();
  const exactA = normalizedA === query.toLocaleLowerCase() ? 0 : 1;
  const exactB = normalizedB === query.toLocaleLowerCase() ? 0 : 1;
  return exactA - exactB || normalizedA.localeCompare(normalizedB, "zh-CN") || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id);
}

function normalizeQuery(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 2 || normalized.length > 80 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new ApiError("WORKSPACE_SEARCH_QUERY_INVALID", 400);
  }
  return normalized;
}

function normalizeLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new ApiError("WORKSPACE_SEARCH_QUERY_INVALID", 400);
  return value;
}

function opaque(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 191 || normalized === "." || normalized === ".."
    || normalized.includes("/") || normalized.includes("\\")) {
    throw new ApiError("WORKSPACE_SEARCH_QUERY_INVALID", 400, { conflictFields: [label] });
  }
  return normalized;
}
