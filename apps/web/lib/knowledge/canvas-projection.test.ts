import assert from "node:assert/strict";
import test from "node:test";
import { createKnowledgeCanvasLayoutQueue, enqueueKnowledgeCanvasLayoutPatches } from "@areaforge/core";
import {
  mergeKnowledgeCanvasPage,
  overlayPendingKnowledgeCanvasLayout,
  preserveLocalKnowledgeCanvasLayout,
  projectVisibleKnowledgeCanvas,
} from "@/lib/knowledge/canvas-projection";
import type { KnowledgeCanvasQueryDto } from "@/lib/contracts";

function canvas(overrides: Partial<KnowledgeCanvasQueryDto> = {}): KnowledgeCanvasQueryDto {
  const nodes: KnowledgeCanvasQueryDto["nodes"] = [
    node("SUBJECT:parent", "SUBJECT", "parent", null, { collapsed: true }),
    node("NOTE:child", "NOTE", "child", "SUBJECT:parent"),
    node("MISTAKE:related", "MISTAKE", "related", null),
  ];
  return {
    workspaceId: "workspace-1",
    focusId: "SUBJECT:parent",
    depth: 1,
    syncedAt: "2026-08-20T00:00:00.000Z",
    nodes,
    hiddenNodes: [],
    edges: [
      { id: "contains", sourceId: "SUBJECT:parent", targetId: "NOTE:child", kind: "contains" },
      { id: "related", sourceId: "NOTE:child", targetId: "MISTAKE:related", kind: "related" },
    ],
    list: nodes.map(({ id, entityType, label, href, subjectId }) => ({ id, entityType, label, href, subjectId })),
    nextCursor: null,
    truncated: false,
    graphNodeCount: nodes.length,
    graphEdgeCount: 2,
    pageContextTruncated: false,
    loadStats: {
      candidateRowsRead: 3,
      ancestorRowsRead: 0,
      relationRowsRead: 2,
      returnedNodeRows: 3,
      returnedEdgeRows: 2,
      candidateWindowLimit: 80,
      relationWindowLimit: 80,
      layoutRowsRead: 0,
      staleLayoutRowsRead: 0,
    },
    filterOptions: { subjects: [] },
    layout: {
      workspaceId: "workspace-1",
      revision: 2,
      viewportX: 1,
      viewportY: 2,
      viewportZoom: 1,
      hasSavedLayout: true,
      updatedAt: "2026-08-20T00:00:00.000Z",
      staleLayoutCandidates: [],
    },
    ...overrides,
  };
}

function node(
  id: string,
  entityType: KnowledgeCanvasQueryDto["nodes"][number]["entityType"],
  entityId: string,
  parentId: string | null,
  overrides: Partial<KnowledgeCanvasQueryDto["nodes"][number]> = {},
): KnowledgeCanvasQueryDto["nodes"][number] {
  return {
    id,
    entityType,
    entityId,
    label: id,
    subjectId: null,
    parentId,
    href: null,
    x: 0,
    y: 0,
    collapsed: false,
    pinned: false,
    hidden: false,
    contextOnly: false,
    ...overrides,
  };
}

test("visible projection combines collapsed branches and relation filters", () => {
  const collapsed = projectVisibleKnowledgeCanvas(canvas(), new Set(), "");
  assert.deepEqual(collapsed.nodes.map((item) => item.id), ["SUBJECT:parent", "MISTAKE:related"]);

  const expandedRelated = projectVisibleKnowledgeCanvas(canvas(), new Set(["SUBJECT:parent"]), "related");
  assert.deepEqual(expandedRelated.nodes.map((item) => item.id), ["NOTE:child", "MISTAKE:related"]);
  assert.deepEqual(expandedRelated.edges.map((edge) => edge.id), ["related"]);
});

test("pending and preserved layout overlays keep local edits over remote responses", () => {
  const local = canvas();
  const incoming = canvas({ layout: { ...local.layout, revision: 3, viewportX: 50 } });
  const queue = enqueueKnowledgeCanvasLayoutPatches(createKnowledgeCanvasLayoutQueue(), [{
    entityType: "NOTE",
    entityId: "child",
    x: 40,
    y: 60,
    hidden: true,
  }]);
  const overlaid = overlayPendingKnowledgeCanvasLayout(incoming, local, queue);
  assert.equal(overlaid.nodes.some((item) => item.id === "NOTE:child"), false);
  assert.equal(overlaid.hiddenNodes[0]?.x, 40);
  assert.equal(overlaid.layout.revision, local.layout.revision);

  const preserved = preserveLocalKnowledgeCanvasLayout(incoming, {
    ...local,
    nodes: local.nodes.map((item) => item.id === "NOTE:child" ? { ...item, x: 90 } : item),
  });
  assert.equal(preserved.nodes.find((item) => item.id === "NOTE:child")?.x, 90);
  assert.equal(preserved.layout.revision, local.layout.revision);
});

test("page merge is deterministic and enforces the rendered node limit", () => {
  const current = canvas({ nodes: [node("NOTE:one", "NOTE", "one", null)] });
  const incoming = canvas({
    nodes: [node("NOTE:one", "NOTE", "one", null, { label: "new" }), node("NOTE:two", "NOTE", "two", null)],
    nextCursor: "NOTE:two",
    truncated: true,
  });
  const merged = mergeKnowledgeCanvasPage({
    current,
    incoming,
    queue: createKnowledgeCanvasLayoutQueue(),
    maxRenderedNodes: 2,
  });
  assert.equal(merged.limitReached, false);
  assert.deepEqual(merged.canvas?.nodes.map((item) => [item.id, item.label]), [["NOTE:one", "new"], ["NOTE:two", "NOTE:two"]]);
  assert.equal(merged.canvas?.nextCursor, "NOTE:two");

  const limited = mergeKnowledgeCanvasPage({
    current,
    incoming,
    queue: createKnowledgeCanvasLayoutQueue(),
    maxRenderedNodes: 1,
  });
  assert.deepEqual(limited, { canvas: null, limitReached: true });
});
