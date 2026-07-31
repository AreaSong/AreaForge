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
export const KNOWLEDGE_CANVAS_MAX_RENDERED_NODES = 500;

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

export interface KnowledgeCanvasViewportInput {
  viewportX: number;
  viewportY: number;
  viewportZoom: number;
}

export interface KnowledgeCanvasLayoutQueueState {
  pending: KnowledgeCanvasNodeLayoutInput[];
  inFlight: KnowledgeCanvasNodeLayoutInput[];
  pendingViewport: KnowledgeCanvasViewportInput | null;
  inFlightViewport: KnowledgeCanvasViewportInput | null;
}

function layoutNodeKey(node: Pick<KnowledgeCanvasNodeLayoutInput, "entityType" | "entityId">): string {
  return `${node.entityType}:${node.entityId}`;
}

function mergeLayoutNodePatches(
  older: KnowledgeCanvasNodeLayoutInput[],
  newer: KnowledgeCanvasNodeLayoutInput[],
): KnowledgeCanvasNodeLayoutInput[] {
  const merged = new Map(older.map((node) => [layoutNodeKey(node), node]));
  for (const node of newer) {
    const previous = merged.get(layoutNodeKey(node));
    merged.set(layoutNodeKey(node), previous ? { ...previous, ...node } : node);
  }
  return [...merged.values()];
}

export function createKnowledgeCanvasLayoutQueue(): KnowledgeCanvasLayoutQueueState {
  return {
    pending: [],
    inFlight: [],
    pendingViewport: null,
    inFlightViewport: null,
  };
}

export function enqueueKnowledgeCanvasLayoutPatches(
  state: KnowledgeCanvasLayoutQueueState,
  patches: KnowledgeCanvasNodeLayoutInput[],
): KnowledgeCanvasLayoutQueueState {
  return { ...state, pending: mergeLayoutNodePatches(state.pending, patches) };
}

export function enqueueKnowledgeCanvasViewportPatch(
  state: KnowledgeCanvasLayoutQueueState,
  viewport: KnowledgeCanvasViewportInput,
): KnowledgeCanvasLayoutQueueState {
  return { ...state, pendingViewport: viewport };
}

export function hasKnowledgeCanvasLayoutQueueWork(state: KnowledgeCanvasLayoutQueueState): boolean {
  return state.pending.length > 0 ||
    state.inFlight.length > 0 ||
    state.pendingViewport !== null ||
    state.inFlightViewport !== null;
}

export function beginKnowledgeCanvasLayoutSave(state: KnowledgeCanvasLayoutQueueState): {
  state: KnowledgeCanvasLayoutQueueState;
  batch: KnowledgeCanvasNodeLayoutInput[];
  viewport: KnowledgeCanvasViewportInput | null;
} {
  if (state.inFlight.length > 0 || state.inFlightViewport !== null) {
    return { state, batch: [], viewport: null };
  }
  if (state.pending.length === 0 && state.pendingViewport === null) {
    return { state, batch: [], viewport: null };
  }
  return {
    state: {
      pending: [],
      inFlight: state.pending,
      pendingViewport: null,
      inFlightViewport: state.pendingViewport,
    },
    batch: state.pending,
    viewport: state.pendingViewport,
  };
}

export function completeKnowledgeCanvasLayoutSave(
  state: KnowledgeCanvasLayoutQueueState,
): KnowledgeCanvasLayoutQueueState {
  return { ...state, inFlight: [], inFlightViewport: null };
}

export function restoreKnowledgeCanvasLayoutSave(
  state: KnowledgeCanvasLayoutQueueState,
): KnowledgeCanvasLayoutQueueState {
  return {
    pending: mergeLayoutNodePatches(state.inFlight, state.pending),
    inFlight: [],
    pendingViewport: state.pendingViewport ?? state.inFlightViewport,
    inFlightViewport: null,
  };
}

export function shouldApplyKnowledgeCanvasResponseLayout(input: {
  requestMutationGeneration: number;
  currentMutationGeneration: number;
  incomingRevision: number;
  currentRevision: number;
}): boolean {
  return input.requestMutationGeneration === input.currentMutationGeneration &&
    input.incomingRevision >= input.currentRevision;
}

export function applyKnowledgeCanvasLayoutPatches<
  T extends KnowledgeCanvasNodeLayoutInput,
>(nodes: T[], patches: KnowledgeCanvasNodeLayoutInput[]): T[] {
  const byId = new Map(patches.map((node) => [layoutNodeKey(node), node]));
  return nodes.map((node) => {
    const patch = byId.get(layoutNodeKey(node));
    return patch ? { ...node, ...patch } : node;
  });
}

export function isKnowledgeCanvasEntityType(value: string): value is KnowledgeCanvasEntityType {
  return (KNOWLEDGE_CANVAS_ENTITY_TYPES as readonly string[]).includes(value);
}

export function isKnowledgeCanvasCursor(value: string | null | undefined): boolean {
  if (!value) return false;
  const separator = value.indexOf(":");
  return separator > 0 &&
    separator === value.lastIndexOf(":") &&
    separator < value.length - 1 &&
    isKnowledgeCanvasEntityType(value.slice(0, separator));
}

export function clampCanvasDepth(depth: number | null | undefined): number {
  if (depth == null || !Number.isFinite(depth)) return 1;
  return Math.min(KNOWLEDGE_CANVAS_MAX_DEPTH, Math.max(0, Math.floor(depth)));
}

export function clampCanvasPageSize(limit: number | null | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return 80;
  // Every non-empty continuation needs room for the stable focus plus one
  // candidate; accepting limit=1 without this floor cannot advance the cursor.
  return Math.min(KNOWLEDGE_CANVAS_MAX_NODES_PER_PAGE, Math.max(2, Math.floor(limit)));
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
  invalidCursor: boolean;
  contextTruncated: boolean;
} {
  const depth = clampCanvasDepth(input.depth);
  const limit = clampCanvasPageSize(input.limit);
  const q = input.query?.trim().toLowerCase() ?? "";

  const byId = new Map(input.nodes.map((node) => [node.id, node]));
  const focus = byId.get(input.focusId);
  if (!focus) {
    return {
      nodes: [],
      edges: [],
      nextCursor: null,
      truncated: false,
      invalidCursor: false,
      contextTruncated: false,
    };
  }

  const adjacent = new Map<string, string[]>();
  const incidentEdges = new Map<string, KnowledgeCanvasEdgeInput[]>();
  for (const edge of input.edges) {
    if (!byId.has(edge.sourceId) || !byId.has(edge.targetId)) continue;
    adjacent.set(edge.sourceId, [...(adjacent.get(edge.sourceId) ?? []), edge.targetId]);
    adjacent.set(edge.targetId, [...(adjacent.get(edge.targetId) ?? []), edge.sourceId]);
    incidentEdges.set(edge.sourceId, [...(incidentEdges.get(edge.sourceId) ?? []), edge]);
    incidentEdges.set(edge.targetId, [...(incidentEdges.get(edge.targetId) ?? []), edge]);
  }

  const reachable = new Set<string>([focus.id]);
  const predecessor = new Map<string, string | null>([[focus.id, null]]);
  let frontier = [focus.id];
  for (let level = 0; level < depth; level += 1) {
    const next: string[] = [];
    for (const sourceId of frontier) {
      for (const targetId of adjacent.get(sourceId) ?? []) {
        if (reachable.has(targetId)) continue;
        reachable.add(targetId);
        predecessor.set(targetId, sourceId);
        next.push(targetId);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  // A text search is workspace-wide. Depth only limits ordinary branch traversal;
  // otherwise a leaf match outside the default workspace layer can never be found.
  const searchScope = q ? input.nodes.map((node) => node.id) : [...reachable];
  const matches = searchScope
    .map((id) => byId.get(id)!)
    .filter((node) => {
      if (input.subjectFilter && node.subjectId !== input.subjectFilter) return false;
      if (input.entityTypeFilter && node.entityType !== input.entityTypeFilter) return false;
      if (q && !node.label.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const candidates = matches.filter((node) => node.id !== focus.id);
  const cursorIndex = input.cursor ? candidates.findIndex((node) => node.id === input.cursor) : -1;
  if (input.cursor && cursorIndex < 0) {
    return {
      nodes: [],
      edges: [],
      nextCursor: null,
      truncated: false,
      invalidCursor: true,
      contextTruncated: false,
    };
  }
  const startIndex = input.cursor && cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const pageIds = new Set<string>([focus.id]);
  let lastAcceptedIndex = startIndex - 1;
  let contextTruncated = false;

  function pathFor(nodeId: string): string[] {
    if (predecessor.has(nodeId)) {
      const path: string[] = [];
      let current: string | null = nodeId;
      while (current) {
        path.push(current);
        current = predecessor.get(current) ?? null;
      }
      return path.reverse();
    }

    // Global search results may sit outside the requested depth. Their canonical
    // parent chain supplies enough context to understand and open the match.
    const path: string[] = [];
    const seen = new Set<string>();
    let current: string | null = nodeId;
    while (current && !seen.has(current)) {
      seen.add(current);
      path.push(current);
      current = byId.get(current)?.parentId ?? null;
    }
    return path.reverse();
  }

  function relationContextFor(nodeId: string): string[] {
    const context = new Set<string>();
    for (const edge of incidentEdges.get(nodeId) ?? []) {
      const otherId = edge.sourceId === nodeId ? edge.targetId : edge.sourceId;
      // A high-level parent can have thousands of canonical children. Each child
      // carries the parent when it is paged, so pulling every child here is wasteful.
      if (byId.get(otherId)?.parentId === nodeId) continue;
      // Do not extend a focused branch past the requested depth only to expose
      // the candidate's own parent; pathFor already carries reachable ancestry.
      if (byId.get(nodeId)?.parentId === otherId && !reachable.has(otherId)) continue;
      context.add(otherId);
    }
    return [...context];
  }

  for (let index = startIndex; index < candidates.length; index += 1) {
    const candidateId = candidates[index]!.id;
    const context = [...pathFor(candidateId), ...relationContextFor(candidateId)];
    const additions = [...new Set(context)].filter((id) => !pageIds.has(id));
    if (pageIds.size + additions.length > limit) {
      if (lastAcceptedIndex >= startIndex) break;
      // A single high-degree candidate must still advance the cursor. Keep the
      // candidate first and mark the omitted relationship context explicitly.
      const prioritized = [candidateId, ...additions.filter((id) => id !== candidateId)];
      for (const id of prioritized) {
        if (pageIds.size >= limit) break;
        pageIds.add(id);
      }
      contextTruncated = prioritized.some((id) => !pageIds.has(id));
      lastAcceptedIndex = index;
      break;
    }
    for (const id of additions) pageIds.add(id);
    lastAcceptedIndex = index;
  }

  const hasMore = lastAcceptedIndex + 1 < candidates.length;
  const nextCursor = hasMore && lastAcceptedIndex >= startIndex
    ? candidates[lastAcceptedIndex]!.id
    : null;
  const page = [...pageIds]
    .map((id) => byId.get(id))
    .filter((node): node is KnowledgeCanvasNodeInput => Boolean(node));
  const edges = input.edges.filter((edge) => pageIds.has(edge.sourceId) && pageIds.has(edge.targetId));

  return {
    nodes: page,
    edges,
    nextCursor,
    truncated: hasMore,
    invalidCursor: false,
    contextTruncated,
  };
}

export function assertLayoutPatchSafe(
  patch: KnowledgeCanvasLayoutPatch,
): "ok" | "missing_revision" | "invalid_viewport" | "invalid_node" | "duplicate_node" | "business_fields_forbidden" {
  if (!Number.isInteger(patch.expectedRevision) || patch.expectedRevision < 1) {
    return "missing_revision";
  }
  if (
    (patch.viewportX !== undefined && !Number.isFinite(patch.viewportX)) ||
    (patch.viewportY !== undefined && !Number.isFinite(patch.viewportY)) ||
    (patch.viewportZoom !== undefined && (!Number.isFinite(patch.viewportZoom) || patch.viewportZoom <= 0))
  ) {
    return "invalid_viewport";
  }
  const nodeKeys = new Set<string>();
  for (const node of patch.nodes ?? []) {
    if (!isKnowledgeCanvasEntityType(node.entityType) || !node.entityId) {
      return "invalid_node";
    }
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      return "invalid_node";
    }
    const key = layoutNodeKey(node);
    if (nodeKeys.has(key)) return "duplicate_node";
    nodeKeys.add(key);
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
