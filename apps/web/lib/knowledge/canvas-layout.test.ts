import assert from "node:assert/strict";
import test from "node:test";
import {
  createKnowledgeCanvasAutoLayout,
  createKnowledgeCanvasFlowLayoutPatches,
  createKnowledgeCanvasNodeLayoutPatch,
  knowledgeCanvasViewport,
  knowledgeCanvasViewportChanged,
  toKnowledgeCanvasViewportInput,
} from "@/lib/knowledge/canvas-layout";
import type { KnowledgeCanvasQueryDto } from "@/lib/contracts";

const layout: KnowledgeCanvasQueryDto["layout"] = {
  workspaceId: "workspace-1",
  revision: 2,
  viewportX: 10,
  viewportY: 20,
  viewportZoom: 1.2,
  hasSavedLayout: true,
  updatedAt: "2026-08-20T00:00:00.000Z",
  staleLayoutCandidates: [],
};

const node: KnowledgeCanvasQueryDto["nodes"][number] = {
  id: "NOTE:one",
  entityType: "NOTE",
  entityId: "one",
  label: "One",
  subjectId: null,
  parentId: null,
  href: null,
  x: 1,
  y: 2,
  collapsed: false,
  pinned: true,
  hidden: false,
  contextOnly: false,
};

function canvas(overrides: Partial<KnowledgeCanvasQueryDto> = {}): KnowledgeCanvasQueryDto {
  return {
    workspaceId: "workspace-1",
    focusId: node.id,
    depth: 1,
    syncedAt: layout.updatedAt,
    nodes: [node],
    hiddenNodes: [],
    edges: [],
    list: [],
    nextCursor: null,
    truncated: false,
    graphNodeCount: 1,
    graphEdgeCount: 0,
    pageContextTruncated: false,
    loadStats: {
      candidateRowsRead: 1,
      ancestorRowsRead: 0,
      relationRowsRead: 0,
      returnedNodeRows: 1,
      returnedEdgeRows: 0,
      candidateWindowLimit: 80,
      relationWindowLimit: 80,
      layoutRowsRead: 1,
      staleLayoutRowsRead: 0,
    },
    filterOptions: { subjects: [] },
    layout,
    ...overrides,
  };
}

test("viewport conversion and comparison preserve ReactFlow coordinates", () => {
  assert.deepEqual(knowledgeCanvasViewport(layout), { x: 10, y: 20, zoom: 1.2 });
  assert.deepEqual(toKnowledgeCanvasViewportInput({ x: 30, y: 40, zoom: 2 }), {
    viewportX: 30,
    viewportY: 40,
    viewportZoom: 2,
  });
  assert.equal(knowledgeCanvasViewportChanged(canvas(), canvas()), false);
  assert.equal(knowledgeCanvasViewportChanged(canvas(), canvas({ layout: { ...layout, viewportX: 11 } })), true);
});

test("node, drag, and auto layout patches retain non-position layout flags", () => {
  assert.deepEqual(createKnowledgeCanvasNodeLayoutPatch(node, { hidden: true }), {
    entityType: "NOTE",
    entityId: "one",
    x: 1,
    y: 2,
    collapsed: false,
    pinned: true,
    hidden: true,
  });
  const dragged = createKnowledgeCanvasFlowLayoutPatches(
    canvas(),
    [{ id: node.id, position: { x: 50, y: 60 }, data: {} }],
    new Set([node.id]),
  );
  assert.deepEqual(dragged[0], { ...createKnowledgeCanvasNodeLayoutPatch(node), x: 50, y: 60 });

  const auto = createKnowledgeCanvasAutoLayout(Array.from({ length: 6 }, (_, index) => ({
    ...node,
    id: `NOTE:${index}`,
    entityId: String(index),
  })));
  assert.deepEqual(auto.map(({ x, y }) => [x, y]), [
    [0, 0], [210, 0], [420, 0], [630, 0], [840, 0], [0, 120],
  ]);
});
