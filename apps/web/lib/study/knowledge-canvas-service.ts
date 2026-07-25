import {
  assertExpectedRevision,
  assertLayoutPatchSafe,
  defaultNodePosition,
  filterStaleLayoutRefs,
  isKnowledgeCanvasCursor,
  isKnowledgeCanvasEntityType,
  selectCanvasChildren,
  type KnowledgeCanvasEntityType,
  type KnowledgeCanvasEdgeInput,
  type KnowledgeCanvasNodeInput,
  type KnowledgeCanvasNodeLayoutInput,
} from "@areaforge/core";
import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { resolveActiveWorkspace } from "./exam-workspace-service";

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
  updatedAt: string;
  staleLayoutCandidates: Array<{ entityType: KnowledgeCanvasEntityType; entityId: string }>;
}

export interface KnowledgeCanvasQueryDto {
  workspaceId: string;
  focusId: string;
  depth: number;
  nodes: KnowledgeCanvasNodeDto[];
  hiddenNodes: KnowledgeCanvasNodeDto[];
  edges: KnowledgeCanvasEdgeDto[];
  list: Array<{ id: string; entityType: KnowledgeCanvasEntityType; label: string; href: string | null; subjectId: string | null }>;
  nextCursor: string | null;
  truncated: boolean;
  filterOptions: {
    subjects: Array<{ id: string; label: string }>;
  };
  layout: KnowledgeCanvasLayoutDto;
}

function nodeKey(entityType: KnowledgeCanvasEntityType, entityId: string): string {
  return `${entityType}:${entityId}`;
}

function detailHref(entityType: KnowledgeCanvasEntityType, entityId: string): string | null {
  switch (entityType) {
    case "WORKSPACE":
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
      return "/knowledge/canvas";
  }
}

async function assertWorkspaceOwner(actorId: string, workspaceId: string) {
  const workspace = await prisma.examWorkspace.findFirst({
    where: { id: workspaceId, userId: actorId },
    select: { id: true },
  });
  if (!workspace) {
    throw new ApiError("WORKSPACE_NOT_FOUND", 404);
  }
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
  const query = input.q?.trim() || null;
  const cursor = input.cursor?.trim() || null;
  const depth = input.depth ?? 1;
  const limit = input.limit ?? 80;
  const queryWindow = Math.min(2000, Math.max(80, limit * (depth + 1) * 2));
  const includeAllStatuses = input.status === "all";
  const structuralTypes = new Set<KnowledgeCanvasEntityType>([
    "WORKSPACE",
    "SUBJECT_GROUP",
    "SUBJECT",
    "SYLLABUS_NODE",
  ]);
  const shouldLoad = (entityType: KnowledgeCanvasEntityType) =>
    !requestedType || requestedType === entityType || structuralTypes.has(entityType) ||
    (requestedType === "REVIEW_SCHEDULE" && ["NOTE", "MISTAKE", "STUDY_RESOURCE"].includes(entityType));

  const [groups, subjects, syllabusNodes, notes, mistakes, resources, tasks, milestones, sessions, schedules, layout] =
    await Promise.all([
      prisma.subjectGroup.findMany({
        where: { workspaceId: workspace.id, archivedAt: null },
        orderBy: { sortOrder: "asc" },
        take: shouldLoad("SUBJECT_GROUP") ? queryWindow : 0,
      }),
      prisma.subject.findMany({
        where: {
          workspaceId: workspace.id,
          archivedAt: null,
        },
        orderBy: { sortOrder: "asc" },
        take: shouldLoad("SUBJECT") ? queryWindow : 0,
      }),
      prisma.syllabusNode.findMany({
        where: {
          subject: { workspaceId: workspace.id },
          archivedAt: null,
          subjectId: input.subjectId || undefined,
        },
        select: { id: true, title: true, subjectId: true, parentId: true },
        orderBy: { sortOrder: "asc" },
        take: shouldLoad("SYLLABUS_NODE") ? queryWindow : 0,
      }),
      prisma.note.findMany({
        where: {
          subject: { workspaceId: workspace.id },
          archivedAt: null,
          subjectId: input.subjectId || undefined,
          title: query ? { contains: query, mode: "insensitive" } : undefined,
        },
        select: { id: true, title: true, subjectId: true, syllabusNodeId: true },
        orderBy: { updatedAt: "desc" },
        take: shouldLoad("NOTE") ? queryWindow : 0,
      }),
      prisma.mistake.findMany({
        where: {
          subject: { workspaceId: workspace.id },
          archivedAt: null,
          subjectId: input.subjectId || undefined,
          title: query ? { contains: query, mode: "insensitive" } : undefined,
        },
        select: { id: true, title: true, subjectId: true, syllabusNodeId: true },
        orderBy: { updatedAt: "desc" },
        take: shouldLoad("MISTAKE") ? queryWindow : 0,
      }),
      prisma.studyResource.findMany({
        where: {
          workspaceId: workspace.id,
          archivedAt: null,
          subjectId: input.subjectId || undefined,
          title: query ? { contains: query, mode: "insensitive" } : undefined,
        },
        select: { id: true, title: true, subjectId: true },
        orderBy: { updatedAt: "desc" },
        take: shouldLoad("STUDY_RESOURCE") ? queryWindow : 0,
      }),
      prisma.studyTask.findMany({
        where: {
          subject: { workspaceId: workspace.id },
          subjectId: input.subjectId || undefined,
          status: includeAllStatuses ? undefined : { in: ["TODO", "IN_PROGRESS", "DEFERRED"] },
          title: query ? { contains: query, mode: "insensitive" } : undefined,
        },
        select: { id: true, title: true, subjectId: true, syllabusNodeId: true },
        orderBy: { updatedAt: "desc" },
        take: shouldLoad("TASK") ? queryWindow : 0,
      }),
      prisma.planMilestone.findMany({
        where: {
          workspaceId: workspace.id,
          archivedAt: null,
          title: query ? { contains: query, mode: "insensitive" } : undefined,
        },
        select: { id: true, title: true },
        orderBy: { sortOrder: "asc" },
        take: shouldLoad("MILESTONE") ? queryWindow : 0,
      }),
      prisma.studySession.findMany({
        where: {
          subject: { workspaceId: workspace.id },
          subjectId: input.subjectId || undefined,
          status: includeAllStatuses ? undefined : { in: ["RUNNING", "PAUSED"] },
        },
        select: { id: true, subjectId: true, status: true },
        take: shouldLoad("STUDY_SESSION") ? queryWindow : 0,
      }),
      prisma.reviewSchedule.findMany({
        where: {
          workspaceId: workspace.id,
          status: includeAllStatuses ? undefined : "ACTIVE",
          OR: input.subjectId ? [
            { note: { subjectId: input.subjectId } },
            { mistake: { subjectId: input.subjectId } },
            { studyResource: { subjectId: input.subjectId } },
            { syllabusNode: { subjectId: input.subjectId } },
          ] : undefined,
        },
        select: {
          id: true,
          noteId: true,
          mistakeId: true,
          studyResourceId: true,
          syllabusNodeId: true,
        },
        take: shouldLoad("REVIEW_SCHEDULE") ? queryWindow : 0,
      }),
      prisma.knowledgeCanvasLayout.findUnique({
        where: { userId_workspaceId: { userId: actorId, workspaceId: workspace.id } },
        include: { nodes: true },
      }),
    ]);

  const nodes: KnowledgeCanvasNodeInput[] = [];
  const edges: KnowledgeCanvasEdgeInput[] = [];
  const workspaceNodeId = nodeKey("WORKSPACE", workspace.id);
  nodes.push({
    id: workspaceNodeId,
    entityType: "WORKSPACE",
    parentId: null,
    label: workspace.name,
    subjectId: null,
  });

  for (const group of groups) {
    const id = nodeKey("SUBJECT_GROUP", group.id);
    nodes.push({
      id,
      entityType: "SUBJECT_GROUP",
      parentId: workspaceNodeId,
      label: group.name,
      subjectId: null,
    });
    edges.push({ id: `contains:${workspaceNodeId}:${id}`, sourceId: workspaceNodeId, targetId: id, kind: "contains" });
  }

  for (const subject of subjects) {
    const id = nodeKey("SUBJECT", subject.id);
    const parentId = subject.groupId ? nodeKey("SUBJECT_GROUP", subject.groupId) : workspaceNodeId;
    nodes.push({
      id,
      entityType: "SUBJECT",
      parentId,
      label: subject.name,
      subjectId: subject.id,
    });
    edges.push({ id: `contains:${parentId}:${id}`, sourceId: parentId, targetId: id, kind: "contains" });
  }

  for (const node of syllabusNodes) {
    const id = nodeKey("SYLLABUS_NODE", node.id);
    const parentId = node.parentId
      ? nodeKey("SYLLABUS_NODE", node.parentId)
      : nodeKey("SUBJECT", node.subjectId);
    nodes.push({
      id,
      entityType: "SYLLABUS_NODE",
      parentId,
      label: node.title,
      subjectId: node.subjectId,
    });
    edges.push({ id: `contains:${parentId}:${id}`, sourceId: parentId, targetId: id, kind: "contains" });
  }

  for (const note of notes) {
    const id = nodeKey("NOTE", note.id);
    const parentId = note.syllabusNodeId
      ? nodeKey("SYLLABUS_NODE", note.syllabusNodeId)
      : nodeKey("SUBJECT", note.subjectId);
    nodes.push({
      id,
      entityType: "NOTE",
      parentId,
      label: note.title,
      subjectId: note.subjectId,
    });
    edges.push({ id: `related:${parentId}:${id}`, sourceId: parentId, targetId: id, kind: "related" });
  }

  for (const mistake of mistakes) {
    const id = nodeKey("MISTAKE", mistake.id);
    const parentId = mistake.syllabusNodeId
      ? nodeKey("SYLLABUS_NODE", mistake.syllabusNodeId)
      : nodeKey("SUBJECT", mistake.subjectId);
    nodes.push({
      id,
      entityType: "MISTAKE",
      parentId,
      label: mistake.title,
      subjectId: mistake.subjectId,
    });
    edges.push({ id: `related:${parentId}:${id}`, sourceId: parentId, targetId: id, kind: "related" });
  }

  for (const resource of resources) {
    const id = nodeKey("STUDY_RESOURCE", resource.id);
    const parentId = resource.subjectId ? nodeKey("SUBJECT", resource.subjectId) : workspaceNodeId;
    nodes.push({
      id,
      entityType: "STUDY_RESOURCE",
      parentId,
      label: resource.title,
      subjectId: resource.subjectId,
    });
    edges.push({ id: `related:${parentId}:${id}`, sourceId: parentId, targetId: id, kind: "related" });
  }

  for (const task of tasks) {
    const id = nodeKey("TASK", task.id);
    const parentId = task.syllabusNodeId
      ? nodeKey("SYLLABUS_NODE", task.syllabusNodeId)
      : nodeKey("SUBJECT", task.subjectId);
    nodes.push({
      id,
      entityType: "TASK",
      parentId,
      label: task.title,
      subjectId: task.subjectId,
    });
    edges.push({ id: `related:${parentId}:${id}`, sourceId: parentId, targetId: id, kind: "related" });
  }

  for (const milestone of milestones) {
    const id = nodeKey("MILESTONE", milestone.id);
    nodes.push({
      id,
      entityType: "MILESTONE",
      parentId: workspaceNodeId,
      label: milestone.title,
      subjectId: null,
    });
    edges.push({
      id: `contains:${workspaceNodeId}:${id}`,
      sourceId: workspaceNodeId,
      targetId: id,
      kind: "contains",
    });
  }

  for (const session of sessions) {
    const id = nodeKey("STUDY_SESSION", session.id);
    const parentId = nodeKey("SUBJECT", session.subjectId);
    nodes.push({
      id,
      entityType: "STUDY_SESSION",
      parentId,
      label: `进行中会话`,
      subjectId: session.subjectId,
    });
    edges.push({ id: `evidence:${parentId}:${id}`, sourceId: parentId, targetId: id, kind: "evidence" });
  }

  for (const schedule of schedules) {
    const id = nodeKey("REVIEW_SCHEDULE", schedule.id);
    const targetId =
      (schedule.noteId && nodeKey("NOTE", schedule.noteId)) ||
      (schedule.mistakeId && nodeKey("MISTAKE", schedule.mistakeId)) ||
      (schedule.studyResourceId && nodeKey("STUDY_RESOURCE", schedule.studyResourceId)) ||
      (schedule.syllabusNodeId && nodeKey("SYLLABUS_NODE", schedule.syllabusNodeId)) ||
      workspaceNodeId;
    const target = nodes.find((node) => node.id === targetId);
    nodes.push({
      id,
      entityType: "REVIEW_SCHEDULE",
      parentId: targetId,
      label: "到期复习",
      subjectId: target?.subjectId ?? null,
    });
    // Keep both directions so expanding the reviewed object reveals its schedule,
    // while opening the schedule still exposes the reviewed object.
    edges.push({ id: `schedules:${targetId}:${id}`, sourceId: targetId, targetId: id, kind: "schedules" });
    edges.push({ id: `schedules:${id}:${targetId}`, sourceId: id, targetId, kind: "schedules" });
  }

  if (cursor && !nodes.some((node) => node.id === cursor)) {
    throw new ApiError("INVALID_CANVAS_CURSOR", 400);
  }

  const focusId = input.focus?.trim() || workspaceNodeId;
  if (input.focus?.trim() && !nodes.some((node) => node.id === focusId)) {
    throw new ApiError("INVALID_CANVAS_FOCUS", 400);
  }
  const selected = selectCanvasChildren({
    nodes,
    edges,
    focusId,
    depth: input.depth ?? 1,
    cursor,
    limit: input.limit,
    subjectFilter: input.subjectId,
    entityTypeFilter: requestedType as KnowledgeCanvasEntityType | null,
    query,
  });

  const layoutByEntity = new Map(
    (layout?.nodes ?? []).map((node) => [`${node.entityType}:${node.entityId}` as string, node]),
  );
  const liveEntityIds = new Set<string>(nodes.map((node) => node.id));
  const stale = filterStaleLayoutRefs({
    nodeLayouts: (layout?.nodes ?? []).map((node) => ({
      entityType: node.entityType as KnowledgeCanvasEntityType,
      entityId: node.entityId,
    })),
    liveEntityIds,
  });

  const dtoNodes: KnowledgeCanvasNodeDto[] = selected.nodes.map((node, index) => {
    const [entityType, entityId] = splitNodeId(node.id);
    const saved = layoutByEntity.get(node.id);
    const fallback = defaultNodePosition(index, entityType === "WORKSPACE" ? 0 : 1);
    return {
      id: node.id,
      entityType,
      entityId,
      label: node.label,
      subjectId: node.subjectId,
      parentId: node.parentId,
      href: detailHref(entityType, entityId),
      x: saved?.x ?? fallback.x,
      y: saved?.y ?? fallback.y,
      collapsed: saved?.collapsed ?? false,
      pinned: saved?.pinned ?? false,
      hidden: saved?.hidden ?? false,
    };
  });

  return {
    workspaceId: workspace.id,
    focusId,
    depth: input.depth ?? 1,
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
    filterOptions: {
      subjects: subjects.map((subject) => ({ id: subject.id, label: subject.name })),
    },
    layout: {
      workspaceId: workspace.id,
      revision: layout?.revision ?? 1,
      viewportX: layout?.viewportX ?? 0,
      viewportY: layout?.viewportY ?? 0,
      viewportZoom: layout?.viewportZoom ?? 1,
      updatedAt: (layout?.updatedAt ?? workspace.updatedAt).toISOString(),
      staleLayoutCandidates: stale.staleCandidates,
    },
  };
}

function splitNodeId(id: string): [KnowledgeCanvasEntityType, string] {
  const index = id.indexOf(":");
  if (index <= 0) {
    return ["WORKSPACE", id];
  }
  return [id.slice(0, index) as KnowledgeCanvasEntityType, id.slice(index + 1)];
}

export async function saveKnowledgeCanvasLayout(
  actorId: string,
  input: {
    workspaceId: string;
    expectedRevision: number;
    viewportX?: number;
    viewportY?: number;
    viewportZoom?: number;
    nodes?: KnowledgeCanvasNodeLayoutInput[];
  },
): Promise<KnowledgeCanvasLayoutDto> {
  await assertWorkspaceOwner(actorId, input.workspaceId);
  const safe = assertLayoutPatchSafe(input);
  if (safe !== "ok") {
    throw new ApiError("INVALID_LAYOUT_PATCH", 400);
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.knowledgeCanvasLayout.findUnique({
      where: { userId_workspaceId: { userId: actorId, workspaceId: input.workspaceId } },
    });

    if (!existing) {
      if (input.expectedRevision !== 1) {
        throw new ApiError("LAYOUT_REVISION_CONFLICT", 409, {
          latest: { revision: 1 },
          conflictFields: ["revision"],
        });
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
        updatedAt: created.updatedAt.toISOString(),
        staleLayoutCandidates: [],
      };
    }

    if (assertExpectedRevision({ currentRevision: existing.revision, expectedRevision: input.expectedRevision }) !== "ok") {
      throw new ApiError("LAYOUT_REVISION_CONFLICT", 409, {
        latest: {
          revision: existing.revision,
          viewportX: existing.viewportX,
          viewportY: existing.viewportY,
          viewportZoom: existing.viewportZoom,
        },
        conflictFields: ["revision"],
      });
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
      const latest = await tx.knowledgeCanvasLayout.findUnique({ where: { id: existing.id } });
      throw new ApiError("LAYOUT_REVISION_CONFLICT", 409, {
        latest: latest ? {
          revision: latest.revision,
          viewportX: latest.viewportX,
          viewportY: latest.viewportY,
          viewportZoom: latest.viewportZoom,
        } : null,
        conflictFields: ["revision"],
      });
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
      updatedAt: updated.updatedAt.toISOString(),
      staleLayoutCandidates: [],
    };
  });
}

export async function resetKnowledgeCanvasLayout(
  actorId: string,
  input: { workspaceId: string; expectedRevision: number },
): Promise<KnowledgeCanvasLayoutDto> {
  await assertWorkspaceOwner(actorId, input.workspaceId);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.knowledgeCanvasLayout.findUnique({
      where: { userId_workspaceId: { userId: actorId, workspaceId: input.workspaceId } },
    });
    if (!existing) {
      return {
        workspaceId: input.workspaceId,
        revision: 1,
        viewportX: 0,
        viewportY: 0,
        viewportZoom: 1,
        updatedAt: new Date().toISOString(),
        staleLayoutCandidates: [],
      };
    }
    if (assertExpectedRevision({ currentRevision: existing.revision, expectedRevision: input.expectedRevision }) !== "ok") {
      throw new ApiError("LAYOUT_REVISION_CONFLICT", 409, {
        latest: { revision: existing.revision },
        conflictFields: ["revision"],
      });
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
      const latest = await tx.knowledgeCanvasLayout.findUnique({ where: { id: existing.id } });
      throw new ApiError("LAYOUT_REVISION_CONFLICT", 409, {
        latest: latest ? { revision: latest.revision } : null,
        conflictFields: ["revision"],
      });
    }
    await tx.knowledgeCanvasNodeLayout.deleteMany({ where: { layoutId: existing.id } });
    const updated = await tx.knowledgeCanvasLayout.findUniqueOrThrow({ where: { id: existing.id } });
    return {
      workspaceId: updated.workspaceId,
      revision: updated.revision,
      viewportX: updated.viewportX,
      viewportY: updated.viewportY,
      viewportZoom: updated.viewportZoom,
      updatedAt: updated.updatedAt.toISOString(),
      staleLayoutCandidates: [],
    };
  });
}

export async function getKnowledgeOverview(actorId: string) {
  const workspace = await resolveActiveWorkspace(actorId);
  const [dueReviews, weakNodes, pendingResources, importCount, noteCount, mistakeCount] = await Promise.all([
    prisma.reviewSchedule.count({
      where: { workspaceId: workspace.id, status: "ACTIVE", dueDate: { lte: new Date() } },
    }),
    prisma.syllabusNode.count({
      where: {
        subject: { workspaceId: workspace.id },
        archivedAt: null,
        OR: [{ status: "WEAK" }, { status: "NEEDS_REVIEW" }],
      },
    }),
    prisma.studyResource.count({
      where: { workspaceId: workspace.id, archivedAt: null },
    }),
    prisma.learningTreeImportBatch.count({ where: { workspaceId: workspace.id } }),
    prisma.note.count({ where: { subject: { workspaceId: workspace.id }, archivedAt: null } }),
    prisma.mistake.count({ where: { subject: { workspaceId: workspace.id }, archivedAt: null } }),
  ]);

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    dueReviews,
    weakNodes,
    pendingResources,
    recentImports: importCount,
    canvasSummary: {
      noteCount,
      mistakeCount,
      resourceCount: pendingResources,
    },
  };
}
