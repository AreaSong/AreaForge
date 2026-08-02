import {
  assertExpectedRevision,
  assertLayoutPatchSafe,
  defaultNodePosition,
  isKnowledgeCanvasCursor,
  isKnowledgeCanvasEntityType,
  type KnowledgeCanvasEdgeInput,
  type KnowledgeCanvasEntityType,
  type KnowledgeCanvasNodeLayoutInput,
} from "@areaforge/core";
import { prisma, type Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { lockActorWorkspaceScope, resolveActiveWorkspace } from "./exam-workspace-service";
import type { KnowledgeCanvasLayoutConflictSnapshot } from "./knowledge-canvas-contract";
import {
  queryKnowledgeCanvasIndexPage,
  queryKnowledgeCanvasStaleLayoutCandidates,
  type KnowledgeCanvasIndexLoadStats,
} from "./knowledge-canvas-query";

export interface KnowledgeCanvasNodeDto {
  id: string;
  entityType: KnowledgeCanvasEntityType;
  entityId: string;
  label: string;
  subjectId: string | null;
  parentId: string | null;
  href: string | null;
  x: number | null;
  y: number | null;
  collapsed: boolean;
  pinned: boolean;
  hidden: boolean;
  contextOnly: boolean;
}

export interface KnowledgeCanvasEdgeDto {
  id: string;
  sourceId: string;
  targetId: string;
  kind: KnowledgeCanvasEdgeInput["kind"];
}

export interface KnowledgeCanvasLayoutDto {
  workspaceId: string;
  revision: number;
  viewportX: number;
  viewportY: number;
  viewportZoom: number;
  hasSavedLayout: boolean;
  updatedAt: string;
  staleLayoutCandidates: Array<{ entityType: KnowledgeCanvasEntityType; entityId: string }>;
}

export interface KnowledgeCanvasQueryDto {
  workspaceId: string;
  focusId: string;
  depth: number;
  syncedAt: string;
  nodes: KnowledgeCanvasNodeDto[];
  hiddenNodes: KnowledgeCanvasNodeDto[];
  edges: KnowledgeCanvasEdgeDto[];
  list: Array<{ id: string; entityType: KnowledgeCanvasEntityType; label: string; href: string | null; subjectId: string | null }>;
  nextCursor: string | null;
  truncated: boolean;
  graphNodeCount: number;
  graphEdgeCount: number;
  pageContextTruncated: boolean;
  loadStats: KnowledgeCanvasIndexLoadStats & {
    layoutRowsRead: number;
    staleLayoutRowsRead: number;
  };
  filterOptions: {
    subjects: Array<{ id: string; label: string }>;
  };
  layout: KnowledgeCanvasLayoutDto;
}

type KnowledgeCanvasLayoutWriteInput = {
  workspaceId: string;
  expectedRevision: number;
  viewportX?: number;
  viewportY?: number;
  viewportZoom?: number;
  nodes?: KnowledgeCanvasNodeLayoutInput[];
};

function nodeKey(entityType: KnowledgeCanvasEntityType, entityId: string): string {
  return `${entityType}:${entityId}`;
}

function detailHref(entityType: KnowledgeCanvasEntityType, entityId: string): string | null {
  switch (entityType) {
    case "WORKSPACE":
      return "/settings/workspace";
    case "SUBJECT_GROUP":
      return "/settings/workspace";
    case "SUBJECT":
      return `/knowledge/overview?subjectId=${encodeURIComponent(entityId)}`;
    case "SYLLABUS_NODE":
      return `/knowledge/syllabus/${encodeURIComponent(entityId)}`;
    case "NOTE":
      return `/knowledge/notes/${encodeURIComponent(entityId)}`;
    case "MISTAKE":
      return `/knowledge/mistakes/${encodeURIComponent(entityId)}`;
    case "STUDY_RESOURCE":
      return `/knowledge/resources/${encodeURIComponent(entityId)}`;
    case "TASK":
      return `/today/tasks/${encodeURIComponent(entityId)}`;
    case "REVIEW_SCHEDULE":
      return `/knowledge/reviews/${encodeURIComponent(entityId)}`;
    case "MILESTONE":
      return "/today/plan";
    case "STUDY_SESSION":
      return `/focus/${encodeURIComponent(entityId)}`;
    default:
      return null;
  }
}

async function assertActiveWorkspaceOwner(
  client: Pick<Prisma.TransactionClient, "examWorkspace">,
  actorId: string,
  workspaceId: string,
) {
  const workspace = await client.examWorkspace.findFirst({
    where: { id: workspaceId, userId: actorId },
    select: { id: true, status: true, revision: true },
  });
  if (!workspace) {
    throw new ApiError("WORKSPACE_NOT_FOUND", 404);
  }
  if (workspace.status !== "ACTIVE") {
    throw new ApiError("WORKSPACE_STATE_CONFLICT", 409, {
      latest: workspace,
      conflictFields: ["status", "revision"],
    });
  }
  return workspace;
}

export async function getKnowledgeCanvas(
  actorId: string,
  input: {
    workspaceId?: string | null;
    focus?: string | null;
    depth?: number | null;
    cursor?: string | null;
    limit?: number | null;
    q?: string | null;
    subjectId?: string | null;
    entityType?: string | null;
    status?: string | null;
  },
): Promise<KnowledgeCanvasQueryDto> {
  if (input.depth != null && (!Number.isInteger(input.depth) || input.depth < 0 || input.depth > 4)) {
    throw new ApiError("INVALID_CANVAS_DEPTH", 400);
  }
  if (input.limit != null && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200)) {
    throw new ApiError("INVALID_CANVAS_LIMIT", 400);
  }
  if (input.cursor != null && input.cursor.trim() && !isKnowledgeCanvasCursor(input.cursor.trim())) {
    throw new ApiError("INVALID_CANVAS_CURSOR", 400);
  }
  if (input.status != null && input.status !== "active" && input.status !== "all") {
    throw new ApiError("INVALID_CANVAS_STATUS", 400);
  }
  const workspace = input.workspaceId
    ? await prisma.examWorkspace.findFirst({ where: { id: input.workspaceId, userId: actorId } })
    : await resolveActiveWorkspace(actorId);
  if (!workspace) {
    throw new ApiError("WORKSPACE_NOT_FOUND", 404);
  }

  const requestedType = input.entityType?.trim() || null;
  if (requestedType && !isKnowledgeCanvasEntityType(requestedType)) {
    throw new ApiError("INVALID_CANVAS_ENTITY_TYPE", 400);
  }
  const requestedFocus = input.focus?.trim() || null;
  if (requestedFocus && !isKnowledgeCanvasCursor(requestedFocus)) {
    throw new ApiError("INVALID_CANVAS_FOCUS", 400);
  }
  const query = input.q?.trim() || null;
  const cursor = input.cursor?.trim() || null;
  const includeAllStatuses = input.status === "all";
  const workspaceNodeId = nodeKey("WORKSPACE", workspace.id);
  const focusId = requestedFocus || workspaceNodeId;
  const [selected, subjects, layout] = await Promise.all([
    queryKnowledgeCanvasIndexPage({
      workspaceId: workspace.id,
      focusId,
      depth: input.depth,
      cursor,
      limit: input.limit,
      query,
      subjectId: input.subjectId,
      entityType: requestedType as KnowledgeCanvasEntityType | null,
      includeAllStatuses,
    }),
    prisma.subject.findMany({
      where: { workspaceId: workspace.id, archivedAt: null },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true, name: true },
      take: 200,
    }),
    prisma.knowledgeCanvasLayout.findUnique({
      where: { userId_workspaceId: { userId: actorId, workspaceId: workspace.id } },
    }),
  ]);
  if (!selected.focusFound) throw new ApiError("CANVAS_FOCUS_NOT_FOUND", 404);
  if (selected.invalidCursor) throw new ApiError("INVALID_CANVAS_CURSOR", 400);

  const [layoutNodes, staleLayoutCandidates] = layout
    ? await Promise.all([
        prisma.knowledgeCanvasNodeLayout.findMany({
          where: {
            layoutId: layout.id,
            OR: selected.nodes.map((node) => ({
              entityType: node.entityType,
              entityId: node.entityId,
            })),
          },
        }),
        queryKnowledgeCanvasStaleLayoutCandidates({ workspaceId: workspace.id, layoutId: layout.id }),
      ])
    : [[], []];

  const layoutByEntity = new Map(
    layoutNodes.map((node) => [`${node.entityType}:${node.entityId}` as string, node]),
  );
  const dtoNodes: KnowledgeCanvasNodeDto[] = selected.nodes.map((node) => {
    const saved = layoutByEntity.get(node.id);
    const fallback = defaultNodePosition(
      Math.floor(node.sortIndex / 5),
      (node.entityType === "WORKSPACE" ? 0 : 1) + (node.sortIndex % 5),
    );
    return {
      id: node.id,
      entityType: node.entityType,
      entityId: node.entityId,
      label: node.label,
      subjectId: node.subjectId,
      parentId: node.parentId,
      href: detailHref(node.entityType, node.entityId),
      x: saved?.x ?? fallback.x,
      y: saved?.y ?? fallback.y,
      collapsed: saved?.collapsed ?? false,
      pinned: saved?.pinned ?? false,
      hidden: saved?.hidden ?? false,
      contextOnly: node.contextOnly,
    };
  });

  return {
    workspaceId: workspace.id,
    focusId,
    depth: input.depth ?? 1,
    syncedAt: new Date().toISOString(),
    nodes: dtoNodes.filter((node) => !node.hidden),
    hiddenNodes: dtoNodes.filter((node) => node.hidden),
    edges: selected.edges,
    list: dtoNodes
      .filter((node) => !node.hidden)
      .map((node) => ({
        id: node.id,
        entityType: node.entityType,
        label: node.label,
        href: node.href,
        subjectId: node.subjectId,
      })),
    nextCursor: selected.nextCursor,
    truncated: selected.truncated,
    graphNodeCount: selected.graphNodeCount,
    graphEdgeCount: selected.graphEdgeCount,
    pageContextTruncated: selected.contextTruncated,
    loadStats: {
      ...selected.loadStats,
      layoutRowsRead: layoutNodes.length,
      staleLayoutRowsRead: staleLayoutCandidates.length,
    },
    filterOptions: {
      subjects: subjects.map((subject) => ({ id: subject.id, label: subject.name })),
    },
    layout: {
      workspaceId: workspace.id,
      revision: layout?.revision ?? 1,
      viewportX: layout?.viewportX ?? 0,
      viewportY: layout?.viewportY ?? 0,
      viewportZoom: layout?.viewportZoom ?? 1,
      hasSavedLayout: Boolean(layout),
      updatedAt: (layout?.updatedAt ?? workspace.updatedAt).toISOString(),
      staleLayoutCandidates,
    },
  };
}

export function isKnowledgeCanvasLayoutIdentityUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") {
    return false;
  }
  const meta = "meta" in error && typeof error.meta === "object" && error.meta !== null
    ? error.meta as Record<string, unknown>
    : null;
  const target = meta?.target;
  if (Array.isArray(target)) {
    return target.length === 2 && target.includes("userId") && target.includes("workspaceId");
  }
  return typeof target === "string" &&
    target.includes("KnowledgeCanvasLayout") &&
    target.includes("userId") &&
    target.includes("workspaceId") &&
    !target.includes("layoutId");
}

async function loadKnowledgeCanvasLayoutConflictSnapshot(
  client: Prisma.TransactionClient,
  actorId: string,
  workspaceId: string,
): Promise<KnowledgeCanvasLayoutConflictSnapshot> {
  const layout = await client.knowledgeCanvasLayout.findUnique({
    where: { userId_workspaceId: { userId: actorId, workspaceId } },
    include: { nodes: { orderBy: [{ entityType: "asc" }, { entityId: "asc" }] } },
  });
  if (!layout) {
    return {
      workspaceId,
      revision: 1,
      viewportX: 0,
      viewportY: 0,
      viewportZoom: 1,
      hasSavedLayout: false,
      updatedAt: new Date(0).toISOString(),
      nodes: [],
    };
  }
  return {
    workspaceId: layout.workspaceId,
    revision: layout.revision,
    viewportX: layout.viewportX,
    viewportY: layout.viewportY,
    viewportZoom: layout.viewportZoom,
    hasSavedLayout: true,
    updatedAt: layout.updatedAt.toISOString(),
    nodes: layout.nodes.map((node) => ({
      entityType: node.entityType as KnowledgeCanvasEntityType,
      entityId: node.entityId,
      x: node.x,
      y: node.y,
      collapsed: node.collapsed,
      pinned: node.pinned,
      hidden: node.hidden,
    })),
  };
}

function knowledgeCanvasLayoutConflictFields(
  input: KnowledgeCanvasLayoutWriteInput,
  latest: KnowledgeCanvasLayoutConflictSnapshot,
): string[] {
  const fields = new Set<string>(["revision"]);
  for (const field of ["viewportX", "viewportY", "viewportZoom"] as const) {
    if (input[field] !== undefined && input[field] !== latest[field]) fields.add(field);
  }
  const latestNodes = new Map(latest.nodes.map((node) => [`${node.entityType}:${node.entityId}`, node]));
  for (const node of input.nodes ?? []) {
    const key = `${node.entityType}:${node.entityId}`;
    const current = latestNodes.get(key);
    if (!current) {
      fields.add(`nodes.${key}`);
      continue;
    }
    for (const field of ["x", "y", "collapsed", "pinned", "hidden"] as const) {
      const proposed = field === "x" || field === "y" ? node[field] : node[field] ?? false;
      if (proposed !== current[field]) fields.add(`nodes.${key}.${field}`);
    }
  }
  return [...fields];
}

async function throwKnowledgeCanvasLayoutConflict(
  client: Prisma.TransactionClient,
  actorId: string,
  input: KnowledgeCanvasLayoutWriteInput,
): Promise<never> {
  const latest = await loadKnowledgeCanvasLayoutConflictSnapshot(client, actorId, input.workspaceId);
  throw new ApiError("LAYOUT_REVISION_CONFLICT", 409, {
    latest,
    conflictFields: knowledgeCanvasLayoutConflictFields(input, latest),
  });
}

export async function saveKnowledgeCanvasLayout(
  actorId: string,
  input: KnowledgeCanvasLayoutWriteInput,
): Promise<KnowledgeCanvasLayoutDto> {
  const safe = assertLayoutPatchSafe(input);
  if (safe !== "ok") {
    throw new ApiError("INVALID_LAYOUT_PATCH", 400);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await lockActorWorkspaceScope(tx, actorId);
      await assertActiveWorkspaceOwner(tx, actorId, input.workspaceId);
      const existing = await tx.knowledgeCanvasLayout.findUnique({
        where: { userId_workspaceId: { userId: actorId, workspaceId: input.workspaceId } },
      });

      if (!existing) {
        if (input.expectedRevision !== 1) {
          return throwKnowledgeCanvasLayoutConflict(tx, actorId, input);
        }
        const created = await tx.knowledgeCanvasLayout.create({
          data: {
            userId: actorId,
            workspaceId: input.workspaceId,
            viewportX: input.viewportX ?? 0,
            viewportY: input.viewportY ?? 0,
            viewportZoom: input.viewportZoom ?? 1,
            revision: 2,
            nodes: {
              create: (input.nodes ?? []).map((node) => ({
                entityType: node.entityType,
                entityId: node.entityId,
                x: node.x,
                y: node.y,
                collapsed: node.collapsed ?? false,
                pinned: node.pinned ?? false,
                hidden: node.hidden ?? false,
              })),
            },
          },
          include: { nodes: true },
        });
        return {
          workspaceId: created.workspaceId,
          revision: created.revision,
          viewportX: created.viewportX,
          viewportY: created.viewportY,
          viewportZoom: created.viewportZoom,
          hasSavedLayout: true,
          updatedAt: created.updatedAt.toISOString(),
          staleLayoutCandidates: [],
        };
      }

      if (assertExpectedRevision({ currentRevision: existing.revision, expectedRevision: input.expectedRevision }) !== "ok") {
        return throwKnowledgeCanvasLayoutConflict(tx, actorId, input);
      }

      const cas = await tx.knowledgeCanvasLayout.updateMany({
        where: { id: existing.id, revision: input.expectedRevision },
        data: {
          viewportX: input.viewportX ?? existing.viewportX,
          viewportY: input.viewportY ?? existing.viewportY,
          viewportZoom: input.viewportZoom ?? existing.viewportZoom,
          revision: { increment: 1 },
        },
      });
      if (cas.count !== 1) {
        return throwKnowledgeCanvasLayoutConflict(tx, actorId, input);
      }

      for (const node of input.nodes ?? []) {
        await tx.knowledgeCanvasNodeLayout.upsert({
          where: {
            layoutId_entityType_entityId: {
              layoutId: existing.id,
              entityType: node.entityType,
              entityId: node.entityId,
            },
          },
          create: {
            layoutId: existing.id,
            entityType: node.entityType,
            entityId: node.entityId,
            x: node.x,
            y: node.y,
            collapsed: node.collapsed ?? false,
            pinned: node.pinned ?? false,
            hidden: node.hidden ?? false,
          },
          update: {
            x: node.x,
            y: node.y,
            collapsed: node.collapsed ?? false,
            pinned: node.pinned ?? false,
            hidden: node.hidden ?? false,
          },
        });
      }

      const updated = await tx.knowledgeCanvasLayout.findUniqueOrThrow({ where: { id: existing.id } });
      return {
        workspaceId: updated.workspaceId,
        revision: updated.revision,
        viewportX: updated.viewportX,
        viewportY: updated.viewportY,
        viewportZoom: updated.viewportZoom,
        hasSavedLayout: true,
        updatedAt: updated.updatedAt.toISOString(),
        staleLayoutCandidates: [],
      };
    });
  } catch (error) {
    if (!isKnowledgeCanvasLayoutIdentityUniqueConstraintError(error)) throw error;
    return throwKnowledgeCanvasLayoutConflict(prisma, actorId, input);
  }
}

export async function resetKnowledgeCanvasLayout(
  actorId: string,
  input: { workspaceId: string; expectedRevision: number },
): Promise<KnowledgeCanvasLayoutDto> {
  return prisma.$transaction(async (tx) => {
    await lockActorWorkspaceScope(tx, actorId);
    await assertActiveWorkspaceOwner(tx, actorId, input.workspaceId);
    const existing = await tx.knowledgeCanvasLayout.findUnique({
      where: { userId_workspaceId: { userId: actorId, workspaceId: input.workspaceId } },
    });
    if (!existing) {
      if (input.expectedRevision !== 1) {
        return throwKnowledgeCanvasLayoutConflict(tx, actorId, input);
      }
      return {
        workspaceId: input.workspaceId,
        revision: 1,
        viewportX: 0,
        viewportY: 0,
        viewportZoom: 1,
        hasSavedLayout: false,
        updatedAt: new Date().toISOString(),
        staleLayoutCandidates: [],
      };
    }
    if (assertExpectedRevision({ currentRevision: existing.revision, expectedRevision: input.expectedRevision }) !== "ok") {
      return throwKnowledgeCanvasLayoutConflict(tx, actorId, input);
    }
    const cas = await tx.knowledgeCanvasLayout.updateMany({
      where: { id: existing.id, revision: input.expectedRevision },
      data: {
        viewportX: 0,
        viewportY: 0,
        viewportZoom: 1,
        revision: { increment: 1 },
      },
    });
    if (cas.count !== 1) {
      return throwKnowledgeCanvasLayoutConflict(tx, actorId, input);
    }
    await tx.knowledgeCanvasNodeLayout.deleteMany({ where: { layoutId: existing.id } });
    const updated = await tx.knowledgeCanvasLayout.findUniqueOrThrow({ where: { id: existing.id } });
    return {
      workspaceId: updated.workspaceId,
      revision: updated.revision,
      viewportX: updated.viewportX,
      viewportY: updated.viewportY,
      viewportZoom: updated.viewportZoom,
      hasSavedLayout: true,
      updatedAt: updated.updatedAt.toISOString(),
      staleLayoutCandidates: [],
    };
  });
}

export async function getKnowledgeOverview(actorId: string) {
  const workspace = await resolveActiveWorkspace(actorId);
  const pendingResourceWhere = {
    workspaceId: workspace.id,
    archivedAt: null,
    subjectId: null,
    tags: { none: {} },
    taskLinks: { none: {} },
    noteLinks: { none: {} },
    mistakeLinks: { none: {} },
    syllabusNodeLinks: { none: {} },
  } as const;
  const [
    dueReviews,
    weakNodes,
    pendingResources,
    importCount,
    noteCount,
    mistakeCount,
    nextReview,
    nextWeakNode,
    nextPendingResource,
    latestImport,
    recentNotes,
    recentMistakes,
  ] = await Promise.all([
    prisma.reviewSchedule.count({
      where: {
        workspaceId: workspace.id,
        status: "ACTIVE",
        dueDate: { lte: new Date() },
        bridgeTasks: { none: { status: { in: ["TODO", "IN_PROGRESS", "DEFERRED"] } } },
      },
    }),
    prisma.syllabusNode.count({
      where: {
        subject: { workspaceId: workspace.id },
        archivedAt: null,
        OR: [{ status: "WEAK" }, { status: "NEEDS_REVIEW" }],
      },
    }),
    prisma.studyResource.count({ where: pendingResourceWhere }),
    prisma.learningTreeImportBatch.count({ where: { workspaceId: workspace.id } }),
    prisma.note.count({ where: { subject: { workspaceId: workspace.id }, archivedAt: null } }),
    prisma.mistake.count({ where: { subject: { workspaceId: workspace.id }, archivedAt: null } }),
    prisma.reviewSchedule.findFirst({
      where: {
        workspaceId: workspace.id,
        status: "ACTIVE",
        dueDate: { lte: new Date() },
        bridgeTasks: { none: { status: { in: ["TODO", "IN_PROGRESS", "DEFERRED"] } } },
      },
      include: { note: true, mistake: true, studyResource: true, syllabusNode: true },
      orderBy: [{ dueDate: "asc" }, { updatedAt: "asc" }],
    }),
    prisma.syllabusNode.findFirst({
      where: {
        subject: { workspaceId: workspace.id },
        archivedAt: null,
        OR: [{ status: "WEAK" }, { status: "NEEDS_REVIEW" }],
      },
      select: { id: true, title: true },
      orderBy: [{ status: "asc" }, { updatedAt: "asc" }],
    }),
    prisma.studyResource.findFirst({
      where: pendingResourceWhere,
      select: { id: true, title: true },
      orderBy: { updatedAt: "asc" },
    }),
    prisma.learningTreeImportBatch.findFirst({
      where: { workspaceId: workspace.id },
      select: { id: true },
      orderBy: { confirmedAt: "desc" },
    }),
    prisma.note.findMany({
      where: { subject: { workspaceId: workspace.id }, archivedAt: null },
      select: { id: true, title: true, updatedAt: true, subject: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 4,
    }),
    prisma.mistake.findMany({
      where: { subject: { workspaceId: workspace.id }, archivedAt: null },
      select: { id: true, title: true, updatedAt: true, subject: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 4,
    }),
  ]);

  const nextAction = nextReview
    ? {
        kind: "review" as const,
        label: nextReview.note?.title ?? nextReview.mistake?.title ?? nextReview.studyResource?.title ?? nextReview.syllabusNode?.title ?? "到期复习",
        href: `/quick-review/${nextReview.id}?returnTo=${encodeURIComponent("/knowledge/reviews")}`,
      }
    : nextWeakNode
      ? { kind: "weak_node" as const, label: nextWeakNode.title, href: `/knowledge/syllabus/${nextWeakNode.id}` }
      : nextPendingResource
        ? { kind: "resource" as const, label: nextPendingResource.title, href: `/knowledge/resources/${nextPendingResource.id}` }
        : latestImport
          ? { kind: "import" as const, label: "最近导入批次", href: `/knowledge/imports/${latestImport.id}` }
          : null;

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    dueReviews,
    weakNodes,
    pendingResources,
    recentImports: importCount,
    nextAction,
    recentEvidence: [
      ...recentNotes.map((note) => ({
        id: note.id,
        type: "note" as const,
        label: "知识卡片",
        title: note.title,
        subjectName: note.subject.name,
        href: `/knowledge/notes/${note.id}`,
        updatedAt: note.updatedAt.toISOString(),
      })),
      ...recentMistakes.map((mistake) => ({
        id: mistake.id,
        type: "mistake" as const,
        label: "错题",
        title: mistake.title,
        subjectName: mistake.subject.name,
        href: `/knowledge/mistakes/${mistake.id}`,
        updatedAt: mistake.updatedAt.toISOString(),
      })),
    ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 6),
    canvasSummary: {
      noteCount,
      mistakeCount,
      resourceCount: pendingResources,
    },
  };
}
