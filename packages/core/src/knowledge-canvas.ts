export const KNOWLEDGE_CANVAS_ENTITY_TYPES = [
  "WORKSPACE",
  "SUBJECT_GROUP",
  "SUBJECT",
  "SYLLABUS_NODE",
  "NOTE",
  "MISTAKE",
  "STUDY_RESOURCE",
  "TASK",
  "MILESTONE",
  "STUDY_SESSION",
  "REVIEW_SCHEDULE",
] as const;

export type KnowledgeCanvasEntityType = (typeof KNOWLEDGE_CANVAS_ENTITY_TYPES)[number];

export const KNOWLEDGE_CANVAS_MAX_DEPTH = 4;
export const KNOWLEDGE_CANVAS_MAX_NODES_PER_PAGE = 200;

export interface KnowledgeCanvasNodeInput {
  id: string;
  entityType: KnowledgeCanvasEntityType;
  parentId: string | null;
  label: string;
  subjectId: string | null;
}

export interface KnowledgeCanvasEdgeInput {
  id: string;
  sourceId: string;
  targetId: string;
  kind: "contains" | "related" | "depends" | "schedules" | "evidence";
}

export interface KnowledgeCanvasNodeLayoutInput {
  entityType: KnowledgeCanvasEntityType;
  entityId: string;
  x: number;
  y: number;
  collapsed?: boolean;
  pinned?: boolean;
  hidden?: boolean;
}

export interface KnowledgeCanvasLayoutPatch {
  expectedRevision: number;
  viewportX?: number;
  viewportY?: number;
  viewportZoom?: number;
  nodes?: KnowledgeCanvasNodeLayoutInput[];
}

export function isKnowledgeCanvasEntityType(value: string): value is KnowledgeCanvasEntityType {
  return (KNOWLEDGE_CANVAS_ENTITY_TYPES as readonly string[]).includes(value);
}

export function clampCanvasDepth(depth: number | null | undefined): number {
  if (depth == null || !Number.isFinite(depth)) return 1;
  return Math.min(KNOWLEDGE_CANVAS_MAX_DEPTH, Math.max(0, Math.floor(depth)));
}

export function clampCanvasPageSize(limit: number | null | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return 80;
  return Math.min(KNOWLEDGE_CANVAS_MAX_NODES_PER_PAGE, Math.max(1, Math.floor(limit)));
}

/** Derive children for one focus node at the next depth; never returns body/URI fields. */
export function selectCanvasChildren(input: {
  nodes: KnowledgeCanvasNodeInput[];
  edges: KnowledgeCanvasEdgeInput[];
  focusId: string;
  depth: number;
  cursor?: string | null;
  limit?: number | null;
  subjectFilter?: string | null;
  entityTypeFilter?: KnowledgeCanvasEntityType | null;
  query?: string | null;
}): {
  nodes: KnowledgeCanvasNodeInput[];
  edges: KnowledgeCanvasEdgeInput[];
  nextCursor: string | null;
  truncated: boolean;
} {
  const depth = clampCanvasDepth(input.depth);
  const limit = clampCanvasPageSize(input.limit);
  const q = input.query?.trim().toLowerCase() ?? "";

  const byId = new Map(input.nodes.map((node) => [node.id, node]));
  const focus = byId.get(input.focusId);
  if (!focus) {
    return { nodes: [], edges: [], nextCursor: null, truncated: false };
  }

  const reachable = new Set<string>([focus.id]);
  let frontier = [focus.id];
  for (let level = 0; level < depth; level += 1) {
    const next: string[] = [];
    for (const edge of input.edges) {
      if (!frontier.includes(edge.sourceId)) continue;
      if (reachable.has(edge.targetId)) continue;
      const target = byId.get(edge.targetId);
      if (!target) continue;
      reachable.add(edge.targetId);
      next.push(edge.targetId);
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  let candidates = [...reachable]
    .map((id) => byId.get(id)!)
    .filter((node) => {
      if (input.subjectFilter && node.subjectId && node.subjectId !== input.subjectFilter) return false;
      if (input.entityTypeFilter && node.entityType !== input.entityTypeFilter) return false;
      if (q && !node.label.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const startIndex = input.cursor ? candidates.findIndex((node) => node.id === input.cursor) + 1 : 0;
  const sliced = candidates.slice(Math.max(0, startIndex), Math.max(0, startIndex) + limit + 1);
  const truncated = sliced.length > limit;
  const page = truncated ? sliced.slice(0, limit) : sliced;
  const pageIds = new Set(page.map((node) => node.id));
  const edges = input.edges.filter((edge) => pageIds.has(edge.sourceId) && pageIds.has(edge.targetId));
  const nextCursor = truncated ? page[page.length - 1]?.id ?? null : null;

  return { nodes: page, edges, nextCursor, truncated };
}

export function assertLayoutPatchSafe(patch: KnowledgeCanvasLayoutPatch): "ok" | "missing_revision" | "invalid_node" | "business_fields_forbidden" {
  if (!Number.isInteger(patch.expectedRevision) || patch.expectedRevision < 1) {
    return "missing_revision";
  }
  for (const node of patch.nodes ?? []) {
    if (!isKnowledgeCanvasEntityType(node.entityType) || !node.entityId) {
      return "invalid_node";
    }
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      return "invalid_node";
    }
    const record = node as KnowledgeCanvasNodeLayoutInput & Record<string, unknown>;
    if ("title" in record || "content" in record || "status" in record || "edges" in record) {
      return "business_fields_forbidden";
    }
  }
  return "ok";
}

export function filterStaleLayoutRefs(input: {
  nodeLayouts: Array<{ entityType: KnowledgeCanvasEntityType; entityId: string }>;
  liveEntityIds: Set<string>;
}): {
  kept: Array<{ entityType: KnowledgeCanvasEntityType; entityId: string }>;
  staleCandidates: Array<{ entityType: KnowledgeCanvasEntityType; entityId: string }>;
} {
  const kept: Array<{ entityType: KnowledgeCanvasEntityType; entityId: string }> = [];
  const staleCandidates: Array<{ entityType: KnowledgeCanvasEntityType; entityId: string }> = [];
  for (const layout of input.nodeLayouts) {
    const key = `${layout.entityType}:${layout.entityId}`;
    if (input.liveEntityIds.has(key)) {
      kept.push(layout);
    } else {
      staleCandidates.push(layout);
    }
  }
  return { kept, staleCandidates: staleCandidates.slice(0, 100) };
}

export function defaultNodePosition(index: number, column = 0): { x: number; y: number } {
  return { x: column * 240, y: index * 96 };
}

/**
 * Personal layout mutation is desktop-only.
 * Mobile clients may search, pan, zoom, expand, and open detail — never drag-save layout.
 */
export function canMutateKnowledgeCanvasLayout(input: { isDesktopViewport: boolean }): boolean {
  return input.isDesktopViewport === true;
}
