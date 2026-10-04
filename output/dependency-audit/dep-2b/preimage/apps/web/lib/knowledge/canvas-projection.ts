import type { KnowledgeCanvasQueryDto } from "@/lib/contracts";
import type {
  KnowledgeCanvasLayoutQueueState,
  KnowledgeCanvasNodeLayoutInput,
} from "@areaforge/core";

export type CanvasRelationKind = KnowledgeCanvasQueryDto["edges"][number]["kind"];

export const canvasRelationKindLabels: Record<CanvasRelationKind, string> = {
  contains: "包含",
  related: "关联",
  depends: "依赖",
  schedules: "排期",
  evidence: "证据",
};

export function isCanvasRelationKind(value: string | undefined): value is CanvasRelationKind {
  return Boolean(value && Object.hasOwn(canvasRelationKindLabels, value));
}

export function projectVisibleKnowledgeCanvas(
  data: KnowledgeCanvasQueryDto,
  mobileCollapseOverrides: Set<string>,
  relationKind: CanvasRelationKind | "",
): KnowledgeCanvasQueryDto {
  return applyRelationFilter(
    applyCollapsedBranches(data, mobileCollapseOverrides),
    relationKind,
  );
}

export function applyKnowledgeCanvasLayoutPatches(
  data: KnowledgeCanvasQueryDto,
  patches: KnowledgeCanvasNodeLayoutInput[],
): KnowledgeCanvasQueryDto {
  const patchById = new Map(patches.map((patch) => [`${patch.entityType}:${patch.entityId}`, patch]));
  const allNodes = [...data.nodes, ...data.hiddenNodes].map((node) => {
    const patch = patchById.get(node.id);
    return patch ? { ...node, ...patch } : node;
  });
  const nodes = allNodes.filter((node) => !node.hidden);
  return {
    ...data,
    nodes,
    hiddenNodes: allNodes.filter((node) => node.hidden),
    list: nodes.map((node) => ({
      id: node.id,
      entityType: node.entityType,
      label: node.label,
      href: node.href,
      subjectId: node.subjectId,
    })),
  };
}

export function overlayPendingKnowledgeCanvasLayout(
  incoming: KnowledgeCanvasQueryDto,
  local: KnowledgeCanvasQueryDto,
  queue: KnowledgeCanvasLayoutQueueState,
): KnowledgeCanvasQueryDto {
  const patches = [...queue.inFlight, ...queue.pending];
  const viewport = queue.pendingViewport ?? queue.inFlightViewport;
  if (patches.length === 0 && viewport === null) return incoming;
  const incomingIds = new Set([...incoming.nodes, ...incoming.hiddenNodes].map((node) => node.id));
  const relevant = patches.filter((patch) => incomingIds.has(`${patch.entityType}:${patch.entityId}`));
  return {
    ...applyKnowledgeCanvasLayoutPatches(incoming, relevant),
    layout: {
      ...local.layout,
      ...(viewport ?? {}),
    },
  };
}

export function preserveLocalKnowledgeCanvasLayout(
  incoming: KnowledgeCanvasQueryDto,
  local: KnowledgeCanvasQueryDto,
): KnowledgeCanvasQueryDto {
  const patches = [...local.nodes, ...local.hiddenNodes].map(toNodeLayoutPatch);
  return {
    ...applyKnowledgeCanvasLayoutPatches(incoming, patches),
    layout: local.layout,
  };
}

export function mergeKnowledgeCanvasPage(input: {
  current: KnowledgeCanvasQueryDto;
  incoming: KnowledgeCanvasQueryDto;
  queue: KnowledgeCanvasLayoutQueueState;
  maxRenderedNodes: number;
}): { canvas: KnowledgeCanvasQueryDto | null; limitReached: boolean } {
  const mergedNodes = mergeById(input.current.nodes, input.incoming.nodes);
  if (mergedNodes.length > input.maxRenderedNodes) {
    return { canvas: null, limitReached: true };
  }
  const merged = {
    ...input.current,
    syncedAt: input.incoming.syncedAt,
    depth: input.incoming.depth,
    nodes: mergedNodes,
    hiddenNodes: mergeById(input.current.hiddenNodes, input.incoming.hiddenNodes),
    edges: mergeById(input.current.edges, input.incoming.edges),
    list: mergeById(input.current.list, input.incoming.list),
    nextCursor: input.incoming.nextCursor,
    truncated: input.incoming.truncated,
    graphNodeCount: input.incoming.graphNodeCount,
    graphEdgeCount: input.incoming.graphEdgeCount,
    pageContextTruncated: input.current.pageContextTruncated || input.incoming.pageContextTruncated,
    loadStats: input.incoming.loadStats,
    filterOptions: input.current.filterOptions,
    layout: input.incoming.layout,
  };
  return {
    canvas: overlayPendingKnowledgeCanvasLayout(merged, input.current, input.queue),
    limitReached: false,
  };
}

export function knowledgeCanvasRelationLabelsByNode(
  edges: KnowledgeCanvasQueryDto["edges"],
): Map<string, Set<string>> {
  const labels = new Map<string, Set<string>>();
  for (const edge of edges) {
    for (const id of [edge.sourceId, edge.targetId]) {
      const values = labels.get(id) ?? new Set<string>();
      values.add(canvasRelationKindLabels[edge.kind]);
      labels.set(id, values);
    }
  }
  return labels;
}

function applyCollapsedBranches(
  data: KnowledgeCanvasQueryDto,
  mobileOverrides: Set<string>,
): KnowledgeCanvasQueryDto {
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  const isCollapsed = (id: string) => {
    const node = byId.get(id);
    if (!node) return false;
    return mobileOverrides.has(id) ? !node.collapsed : node.collapsed;
  };
  const visibleIds = new Set(data.nodes.filter((node) => {
    const seen = new Set<string>();
    let parentId = node.parentId;
    while (parentId && !seen.has(parentId)) {
      if (isCollapsed(parentId)) return false;
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return true;
  }).map((node) => node.id));
  return filterCanvas(data, visibleIds, data.edges);
}

function applyRelationFilter(
  data: KnowledgeCanvasQueryDto,
  relationKind: CanvasRelationKind | "",
): KnowledgeCanvasQueryDto {
  if (!relationKind) return data;
  const edges = data.edges.filter((edge) => edge.kind === relationKind);
  const visibleIds = new Set(edges.flatMap((edge) => [edge.sourceId, edge.targetId]));
  return filterCanvas(data, visibleIds, edges);
}

function filterCanvas(
  data: KnowledgeCanvasQueryDto,
  visibleIds: Set<string>,
  edges: KnowledgeCanvasQueryDto["edges"],
): KnowledgeCanvasQueryDto {
  return {
    ...data,
    nodes: data.nodes.filter((node) => visibleIds.has(node.id)),
    edges: edges.filter((edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId)),
    list: data.list.filter((row) => visibleIds.has(row.id)),
  };
}

function toNodeLayoutPatch(
  node: KnowledgeCanvasQueryDto["nodes"][number],
): KnowledgeCanvasNodeLayoutInput {
  return {
    entityType: node.entityType,
    entityId: node.entityId,
    x: node.x ?? 0,
    y: node.y ?? 0,
    collapsed: node.collapsed,
    pinned: node.pinned,
    hidden: node.hidden,
  };
}

function mergeById<T extends { id: string }>(left: T[], right: T[]): T[] {
  const merged = new Map(left.map((item) => [item.id, item]));
  for (const item of right) merged.set(item.id, item);
  return [...merged.values()];
}
