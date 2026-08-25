import type { KnowledgeCanvasQueryDto } from "@/lib/contracts";
import {
  canMutateKnowledgeCanvasLayout,
  type KnowledgeCanvasNodeLayoutInput,
  type KnowledgeCanvasViewportInput,
} from "@areaforge/core";
import type { Edge, Node, Viewport } from "@xyflow/react";

type CanvasNode = KnowledgeCanvasQueryDto["nodes"][number];
type CanvasNodePatch = Partial<Pick<CanvasNode, "x" | "y" | "collapsed" | "pinned" | "hidden">>;

export function toKnowledgeCanvasFlowNodes(
  data: KnowledgeCanvasQueryDto,
  desktop: boolean,
): Node[] {
  const layoutEditable = canMutateKnowledgeCanvasLayout({ isDesktopViewport: desktop });
  return data.nodes.map((node) => ({
    id: node.id,
    position: { x: node.x ?? 0, y: node.y ?? 0 },
    data: { label: `${node.label} (${node.entityType})`, href: node.href },
    draggable: layoutEditable,
    style: {
      border: "1px solid rgba(255,255,255,0.15)",
      background: "#12171f",
      color: "#e4e4e7",
      borderRadius: 8,
      padding: 8,
      fontSize: 12,
      minWidth: 140,
      width: 180,
      maxWidth: 180,
      overflowWrap: "anywhere",
    },
  }));
}

export function toKnowledgeCanvasFlowEdges(data: KnowledgeCanvasQueryDto): Edge[] {
  return data.edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceId,
    target: edge.targetId,
    label: edge.kind,
    style: { stroke: "rgba(148,163,184,0.5)" },
  }));
}

export function knowledgeCanvasViewport(
  layout: KnowledgeCanvasQueryDto["layout"],
): Viewport {
  return {
    x: layout.viewportX,
    y: layout.viewportY,
    zoom: layout.viewportZoom,
  };
}

export function knowledgeCanvasViewportChanged(
  previous: KnowledgeCanvasQueryDto,
  next: KnowledgeCanvasQueryDto,
): boolean {
  return previous.workspaceId !== next.workspaceId ||
    previous.layout.viewportX !== next.layout.viewportX ||
    previous.layout.viewportY !== next.layout.viewportY ||
    previous.layout.viewportZoom !== next.layout.viewportZoom;
}

export function toKnowledgeCanvasViewportInput(viewport: Viewport): KnowledgeCanvasViewportInput {
  return {
    viewportX: viewport.x,
    viewportY: viewport.y,
    viewportZoom: viewport.zoom,
  };
}

export function applyKnowledgeCanvasViewport(
  canvas: KnowledgeCanvasQueryDto,
  viewport: KnowledgeCanvasViewportInput,
): KnowledgeCanvasQueryDto {
  return {
    ...canvas,
    layout: { ...canvas.layout, ...viewport, hasSavedLayout: true },
  };
}

export function createKnowledgeCanvasFlowLayoutPatches(
  canvas: KnowledgeCanvasQueryDto,
  flowNodes: Node[],
  changedIds: Set<string>,
): KnowledgeCanvasNodeLayoutInput[] {
  const flowById = new Map(flowNodes.map((node) => [node.id, node]));
  return [...changedIds].flatMap((id): KnowledgeCanvasNodeLayoutInput[] => {
    const flowNode = flowById.get(id);
    const node = canvas.nodes.find((item) => item.id === id);
    if (!flowNode || !node) return [];
    return [createKnowledgeCanvasNodeLayoutPatch(node, {
      x: flowNode.position.x,
      y: flowNode.position.y,
    })];
  });
}

export function createKnowledgeCanvasNodeLayoutPatch(
  node: CanvasNode,
  patch: CanvasNodePatch = {},
): KnowledgeCanvasNodeLayoutInput {
  const next = { ...node, ...patch };
  return {
    entityType: next.entityType,
    entityId: next.entityId,
    x: next.x ?? 0,
    y: next.y ?? 0,
    collapsed: next.collapsed,
    pinned: next.pinned,
    hidden: next.hidden,
  };
}

export function createKnowledgeCanvasAutoLayout(
  nodes: CanvasNode[],
): KnowledgeCanvasNodeLayoutInput[] {
  return nodes.map((node, index) => createKnowledgeCanvasNodeLayoutPatch(node, {
    x: (index % 5) * 210,
    y: Math.floor(index / 5) * 120,
  }));
}
