import {
  assertExpectedRevision,
  assertLayoutPatchSafe,
  defaultNodePosition,
  filterStaleLayoutRefs,
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
  edges: KnowledgeCanvasEdgeDto[];
  list: Array<{ id: string; entityType: KnowledgeCanvasEntityType; label: string; href: string | null; subjectId: string | null }>;
  nextCursor: string | null;
  truncated: boolean;
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
      return `/knowledge/syllabus?nodeId=${encodeURIComponent(entityId)}`;
    case "NOTE":
      return `/knowledge/notes/${encodeURIComponent(entityId)}`;
    case "MISTAKE":
      return `/knowledge/mistakes/${encodeURIComponent(entityId)}`;
    case "STUDY_RESOURCE":
      return `/knowledge/resources/${encodeURIComponent(entityId)}`;
    case "TASK":
      return `/today/tasks/${encodeURIComponent(entityId)}`;
    case "REVIEW_SCHEDULE":
      return `/quick-review/${encodeURIComponent(entityId)}`;
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
  },
): Promise<KnowledgeCanvasQueryDto> {
  const workspace = input.workspaceId
    ? await prisma.examWorkspace.findFirst({ where: { id: input.workspaceId, userId: actorId } })
    : await resolveActiveWorkspace(actorId);
  if (!workspace) {
    throw new ApiError("WORKSPACE_NOT_FOUND", 404);
  }

  const [groups, subjects, syllabusNodes, notes, mistakes, resources, tasks, milestones, sessions, schedules, layout] =
    await Promise.all([
      prisma.subjectGroup.findMany({
        where: { workspaceId: workspace.id, archivedAt: null },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.subject.findMany({
        where: { workspaceId: workspace.id, archivedAt: null },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.syllabusNode.findMany({
        where: { subject: { workspaceId: workspace.id }, archivedAt: null },
        select: { id: true, title: true, subjectId: true, parentId: true },
        orderBy: { sortOrder: "asc" },
        take: 2000,
      }),
      prisma.note.findMany({
        where: { subject: { workspaceId: workspace.id }, archivedAt: null },
        select: { id: true, title: true, subjectId: true, syllabusNodeId: true },
        orderBy: { updatedAt: "desc" },
        take: 1000,
      }),
      prisma.mistake.findMany({
        where: { subject: { workspaceId: workspace.id }, archivedAt: null },
        select: { id: true, title: true, subjectId: true, syllabusNodeId: true },
        orderBy: { updatedAt: "desc" },
        take: 1000,
      }),
      prisma.studyResource.findMany({
        where: { workspaceId: workspace.id, archivedAt: null },
        select: { id: true, title: true, subjectId: true },
        orderBy: { updatedAt: "desc" },
        take: 1000,
      }),
      prisma.studyTask.findMany({
        where: { subject: { workspaceId: workspace.id }, status: { in: ["TODO", "IN_PROGRESS", "DEFERRED"] } },
        select: { id: true, title: true, subjectId: true, syllabusNodeId: true },
        orderBy: { updatedAt: "desc" },
        take: 500,
      }),
      prisma.planMilestone.findMany({
        where: { workspaceId: workspace.id, archivedAt: null },
        select: { id: true, title: true },
        orderBy: { sortOrder: "asc" },
        take: 200,
      }),
      prisma.studySession.findMany({
        where: { subject: { workspaceId: workspace.id }, status: { in: ["RUNNING", "PAUSED"] } },
        select: { id: true, subjectId: true, status: true },
        take: 50,
      }),
      prisma.reviewSchedule.findMany({
        where: { workspaceId: workspace.id, status: "ACTIVE" },
        select: {
          id: true,
          noteId: true,
          mistakeId: true,
          studyResourceId: true,
          syllabusNodeId: true,
        },
        take: 500,
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
    edges.push({ id: `schedules:${id}:${targetId}`, sourceId: id, targetId, kind: "schedules" });
  }

  const focusId = input.focus?.trim() || workspaceNodeId;
  const selected = selectCanvasChildren({
    nodes,
    edges,
    focusId,
    depth: input.depth ?? 1,
    cursor: input.cursor,
    limit: input.limit,
    subjectFilter: input.subjectId,
    entityTypeFilter: input.entityType as KnowledgeCanvasEntityType | null,
    query: input.q,
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
          revision: 1,
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

    const updated = await tx.knowledgeCanvasLayout.update({
      where: { id: existing.id },
      data: {
        viewportX: input.viewportX ?? existing.viewportX,
        viewportY: input.viewportY ?? existing.viewportY,
        viewportZoom: input.viewportZoom ?? existing.viewportZoom,
        revision: { increment: 1 },
      },
    });

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
    await tx.knowledgeCanvasNodeLayout.deleteMany({ where: { layoutId: existing.id } });
    const updated = await tx.knowledgeCanvasLayout.update({
      where: { id: existing.id },
      data: {
        viewportX: 0,
        viewportY: 0,
        viewportZoom: 1,
        revision: { increment: 1 },
      },
    });
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
