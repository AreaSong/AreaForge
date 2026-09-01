"use client";

import { isConflict } from "@/lib/client/api-errors";
import { loadKnowledgeCanvas } from "@/lib/api/knowledge-canvas";
import { useEffect, useMemo, useRef, useState, useTransition, type RefObject } from "react";
import {
  hasKnowledgeCanvasLayoutQueueWork,
  KNOWLEDGE_CANVAS_MAX_RENDERED_NODES,
  shouldApplyKnowledgeCanvasResponseLayout,
} from "@areaforge/core";
import type { KnowledgeCanvasQueryDto } from "@/lib/contracts";
import { useRestoreListReturn } from "@/components/list-return-context";
import { updateKnowledgeContext } from "@/lib/client/knowledge-context";
import {
  isCanvasRelationKind,
  mergeKnowledgeCanvasPage,
  overlayPendingKnowledgeCanvasLayout,
  preserveLocalKnowledgeCanvasLayout,
  projectVisibleKnowledgeCanvas,
  type CanvasRelationKind,
} from "@/lib/knowledge/canvas-projection";
import {
  toKnowledgeCanvasFlowEdges,
  toKnowledgeCanvasFlowNodes,
} from "@/lib/knowledge/canvas-layout";
import {
  useKnowledgeCanvasLayoutController,
  type KnowledgeCanvasReloadParams,
} from "@/components/knowledge-canvas-layout-controller";
import { KnowledgeCanvasView } from "@/components/knowledge-canvas-view";

function syncOptionalSearchParam(url: URL, key: string, value: string): void {
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
}

function useHasCanvasLayoutSpace(containerRef: RefObject<HTMLElement | null>) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => setAvailable(container.getBoundingClientRect().width >= 960);
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);
  return available;
}

export function KnowledgeCanvasClient(props: {
  initial: KnowledgeCanvasQueryDto;
  initialQuery?: string;
  initialEntityType?: string;
  initialSubjectId?: string;
  initialRelationKind?: string;
  initialStatus?: "active" | "all";
  initialView?: "canvas" | "list";
}) {
  useRestoreListReturn();
  const canvasRootRef = useRef<HTMLDivElement>(null);
  const desktop = useHasCanvasLayoutSpace(canvasRootRef);
  const [query, setQuery] = useState(props.initialQuery ?? "");
  const [entityTypeFilter, setEntityTypeFilter] = useState(props.initialEntityType ?? "");
  const [subjectFilter, setSubjectFilter] = useState(props.initialSubjectId ?? "");
  const [relationKindFilter, setRelationKindFilter] = useState<CanvasRelationKind | "">(
    isCanvasRelationKind(props.initialRelationKind) ? props.initialRelationKind : "",
  );
  const [statusFilter, setStatusFilter] = useState<"active" | "all">(props.initialStatus ?? "active");
  const [view, setView] = useState<"canvas" | "list">(props.initialView ?? "canvas");
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [nodeLimitReached, setNodeLimitReached] = useState(false);
  const reloadRequestGenerationRef = useRef(0);
  const lastReloadRef = useRef<KnowledgeCanvasReloadParams>({});
  const layout = useKnowledgeCanvasLayoutController({
    initial: props.initial,
    desktop,
    reload,
    setError,
    setOffline,
    startTransition,
  });
  const {
    canvas,
    layoutPending,
    layoutAnnouncement,
    layoutDirty,
    layoutConflict,
    mobileCollapseOverrides,
    viewport,
    draggedNodes,
    selectedNodeId,
    groupTargetId,
    hiddenTargetId,
    resetOpen,
    canvasRef,
    layoutQueueRef,
    layoutMutationGenerationRef,
    hiddenRestoreSelectRef,
    resetLayoutTriggerRef,
    layoutConflictReturnFocusRef,
    replaceCanvas,
    replaceDraggedNodes,
    setViewport,
    setSelectedNodeId,
    setGroupTargetId,
    setHiddenTargetId,
    setResetOpen,
    focusBranch,
    enqueueViewport,
    retryLayoutQueue,
    adoptLatestLayoutConflict,
    retryLayoutConflict,
    autoLayout,
    onNodesChange,
    resetLayout,
  } = layout;

  const visibleCanvas = useMemo(
    () => projectVisibleKnowledgeCanvas(
      canvas,
      desktop ? new Set<string>() : mobileCollapseOverrides,
      relationKindFilter,
    ),
    [canvas, desktop, mobileCollapseOverrides, relationKindFilter],
  );
  const nodes = useMemo(
    () => draggedNodes?.filter((node) => visibleCanvas.nodes.some((visible) => visible.id === node.id))
      ?? toKnowledgeCanvasFlowNodes(visibleCanvas, desktop),
    [desktop, draggedNodes, visibleCanvas],
  );
  const edges = useMemo(() => toKnowledgeCanvasFlowEdges(visibleCanvas), [visibleCanvas]);
  const effectiveSelectedNodeId = visibleCanvas.nodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : visibleCanvas.nodes[0]?.id ?? "";
  const effectiveHiddenTargetId = canvas.hiddenNodes.some((node) => node.id === hiddenTargetId) ? hiddenTargetId : canvas.hiddenNodes[0]?.id ?? "";
  const selectedNode = canvas.nodes.find((node) => node.id === effectiveSelectedNodeId) ?? null;
  const selectedNodeCollapsed = selectedNode
    ? (!desktop && mobileCollapseOverrides.has(selectedNode.id) ? !selectedNode.collapsed : selectedNode.collapsed)
    : false;

  useEffect(() => {
    const updateOffline = () => setOffline(!navigator.onLine);
    updateOffline();
    window.addEventListener("online", updateOffline);
    window.addEventListener("offline", updateOffline);
    return () => {
      window.removeEventListener("online", updateOffline);
      window.removeEventListener("offline", updateOffline);
    };
  }, []);

  async function reload(params: { focus?: string; cursor?: string | null; depth?: number; resetFilters?: boolean } = {}) {
    lastReloadRef.current = params;
    const requestGeneration = ++reloadRequestGenerationRef.current;
    const requestMutationGeneration = layoutMutationGenerationRef.current;
    const requestCanvas = canvasRef.current;
    if (!hasKnowledgeCanvasLayoutQueueWork(layoutQueueRef.current)) {
      setError(null);
    }
    setLoading(true);
    const search = new URLSearchParams();
    search.set("workspaceId", requestCanvas.workspaceId);
    search.set("depth", String(params?.depth ?? requestCanvas.depth ?? 1));
    if (params?.focus) search.set("focus", params.focus);
    if (params?.cursor) search.set("cursor", params.cursor);
    if (!params.resetFilters && query.trim()) search.set("q", query.trim());
    if (!params.resetFilters && entityTypeFilter) search.set("entityType", entityTypeFilter);
    if (!params.resetFilters && subjectFilter) search.set("subjectId", subjectFilter);
    search.set("status", params.resetFilters ? "active" : statusFilter);
    try {
      const result = await loadKnowledgeCanvas({
        workspaceId: requestCanvas.workspaceId,
        depth: params?.depth ?? requestCanvas.depth ?? 1,
        focus: params?.focus,
        cursor: params?.cursor,
        q: !params.resetFilters ? query.trim() || undefined : undefined,
        entityType: !params.resetFilters ? entityTypeFilter || undefined : undefined,
        subjectId: !params.resetFilters ? subjectFilter || undefined : undefined,
        status: params.resetFilters ? "active" : statusFilter,
      });
      if (!result.ok || !result.body?.canvas) {
        setError(isConflict(result) ? "画布状态已变化，请重试" : "画布加载失败，已保留当前内容");
        return false;
      }
      const body = { canvas: result.body.canvas };
      if (requestGeneration !== reloadRequestGenerationRef.current) return false;
      setOffline(false);
      updateKnowledgeContext({
        workspaceId: requestCanvas.workspaceId,
        q: params.resetFilters ? null : query.trim() || null,
      });
      const currentBeforeApply = canvasRef.current;
      const mayApplyRemoteLayout = shouldApplyKnowledgeCanvasResponseLayout({
        requestMutationGeneration,
        currentMutationGeneration: layoutMutationGenerationRef.current,
        incomingRevision: body.canvas.layout.revision,
        currentRevision: currentBeforeApply.layout.revision,
      });
      const incomingCanvas = mayApplyRemoteLayout
        ? body.canvas
        : preserveLocalKnowledgeCanvasLayout(body.canvas, currentBeforeApply);
      if (!params.cursor) {
        const nextCanvas = overlayPendingKnowledgeCanvasLayout(incomingCanvas, currentBeforeApply, layoutQueueRef.current);
        replaceCanvas(nextCanvas);
        replaceDraggedNodes(null);
        setNodeLimitReached(false);
        setSelectedNodeId(incomingCanvas.focusId);
        if (params.resetFilters) {
          setQuery("");
          setEntityTypeFilter("");
          setSubjectFilter("");
          setRelationKindFilter("");
          setStatusFilter("active");
        }
        if (params.focus) {
          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.set("focus", params.focus);
          nextUrl.searchParams.delete("syllabusNodeId");
          syncOptionalSearchParam(nextUrl, "q", params.resetFilters ? "" : query.trim());
          syncOptionalSearchParam(nextUrl, "entityType", params.resetFilters ? "" : entityTypeFilter);
          syncOptionalSearchParam(nextUrl, "subjectId", params.resetFilters ? "" : subjectFilter);
          syncOptionalSearchParam(nextUrl, "relation", params.resetFilters ? "" : relationKindFilter);
          syncOptionalSearchParam(nextUrl, "status", params.resetFilters || statusFilter === "active" ? "" : statusFilter);
          syncOptionalSearchParam(nextUrl, "view", view === "list" ? "list" : "");
          syncOptionalSearchParam(nextUrl, "depth", incomingCanvas.depth === 1 ? "" : String(incomingCanvas.depth));
          window.history.pushState(null, "", nextUrl);
        }
        return true;
      }

      const currentCanvas = canvasRef.current;
      const merged = mergeKnowledgeCanvasPage({
        current: currentCanvas,
        incoming: incomingCanvas,
        queue: layoutQueueRef.current,
        maxRenderedNodes: KNOWLEDGE_CANVAS_MAX_RENDERED_NODES,
      });
      if (merged.limitReached || !merged.canvas) {
        setNodeLimitReached(true);
        return false;
      }
      replaceCanvas(merged.canvas);
      replaceDraggedNodes(null);
      return true;
    } catch {
      setOffline(!navigator.onLine);
      setError(navigator.onLine ? "网络请求失败，已保留当前内容" : "当前离线，已保留上次同步内容");
      return false;
    } finally {
      if (requestGeneration === reloadRequestGenerationRef.current) setLoading(false);
    }
  }

  function toggleSelectedCollapsed() {
    return layout.toggleSelectedCollapsed(selectedNode, selectedNodeCollapsed);
  }

  function nudgeSelected(dx: number, dy: number) {
    return layout.nudgeSelected(selectedNode, dx, dy);
  }

  function toggleSelectedPinned() {
    return layout.toggleSelectedPinned(selectedNode);
  }

  function hideSelectedNode() {
    return layout.hideSelectedNode(selectedNode);
  }

  function moveSelectedToGroup() {
    return layout.moveSelectedToGroup(selectedNode, groupTargetId);
  }

  function restoreHiddenNode() {
    return layout.restoreHiddenNode(effectiveHiddenTargetId);
  }

  function retryLastReload() {
    void reload(lastReloadRef.current);
  }

  function toggleEquivalentView(): void {
    const next = view === "canvas" ? "list" : "canvas";
    setView(next);
    const url = new URL(window.location.href);
    if (next === "list") url.searchParams.set("view", "list");
    else url.searchParams.delete("view");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
  return (
    <KnowledgeCanvasView
      state={{
        canvas,
        visibleCanvas,
        nodes,
        edges,
        query,
        entityTypeFilter,
        subjectFilter,
        relationKindFilter,
        statusFilter,
        view,
        desktop,
        effectiveSelectedNodeId,
        effectiveHiddenTargetId,
        selectedNode,
        selectedNodeCollapsed,
        groupTargetId,
        offline,
        error,
        layoutDirty,
        layoutPending,
        layoutAnnouncement,
        layoutConflict,
        nodeLimitReached,
        pending,
        loading,
        createOpen,
        resetOpen,
        viewport,
      }}
      rootRef={canvasRootRef}
      hiddenRestoreSelectRef={hiddenRestoreSelectRef}
      resetLayoutTriggerRef={resetLayoutTriggerRef}
      layoutConflictReturnFocusRef={layoutConflictReturnFocusRef}
      actions={{
        setQuery,
        setEntityTypeFilter,
        setSubjectFilter,
        setRelationKindFilter,
        setStatusFilter,
        reload,
        toggleEquivalentView,
        setCreateOpen,
        setResetOpen,
        setSelectedNodeId,
        nudgeSelected: (dx, dy) => void nudgeSelected(dx, dy),
        setGroupTargetId,
        autoLayout: () => void autoLayout(),
        toggleSelectedPinned: () => void toggleSelectedPinned(),
        moveSelectedToGroup: () => void moveSelectedToGroup(),
        hideSelectedNode: () => void hideSelectedNode(),
        setHiddenTargetId,
        restoreHiddenNode: () => void restoreHiddenNode(),
        focusBranch: (id) => void focusBranch(id),
        toggleSelectedCollapsed: () => void toggleSelectedCollapsed(),
        retryLayoutQueue,
        retryLastReload,
        onNodesChange,
        setViewport,
        enqueueViewport: (nextViewport) => {
          enqueueViewport(nextViewport);
        },
        resetLayout: () => void resetLayout(),
        adoptLatestLayoutConflict: () => void adoptLatestLayoutConflict(),
        retryLayoutConflict,
      }}
    />
  );
}
