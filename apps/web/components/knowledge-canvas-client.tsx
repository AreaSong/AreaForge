"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  Focus,
  Pin,
  PinOff,
  RefreshCw,
  WandSparkles,
  WifiOff,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Node,
  type Edge,
  type NodeChange,
  type Viewport,
  applyNodeChanges,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  beginKnowledgeCanvasLayoutSave,
  canMutateKnowledgeCanvasLayout,
  completeKnowledgeCanvasLayoutSave,
  createKnowledgeCanvasLayoutQueue,
  enqueueKnowledgeCanvasLayoutPatches,
  enqueueKnowledgeCanvasViewportPatch,
  hasKnowledgeCanvasLayoutQueueWork,
  KNOWLEDGE_CANVAS_ENTITY_TYPES,
  KNOWLEDGE_CANVAS_MAX_RENDERED_NODES,
  restoreKnowledgeCanvasLayoutSave,
  shouldApplyKnowledgeCanvasResponseLayout,
  type KnowledgeCanvasLayoutQueueState,
  type KnowledgeCanvasNodeLayoutInput,
} from "@areaforge/core";
import type { KnowledgeCanvasQueryDto } from "@/lib/study/knowledge-canvas-service";
import { Drawer, Modal } from "@/components/ui/overlays";
import { ListDetailLink, useRestoreListReturn } from "@/components/list-return-context";
import { updateKnowledgeContext } from "@/lib/client/knowledge-context";

type CanvasRelationKind = KnowledgeCanvasQueryDto["edges"][number]["kind"];

const relationKindLabels: Record<CanvasRelationKind, string> = {
  contains: "包含",
  related: "关联",
  depends: "依赖",
  schedules: "排期",
  evidence: "证据",
};

function isCanvasRelationKind(value: string | undefined): value is CanvasRelationKind {
  return Boolean(value && Object.hasOwn(relationKindLabels, value));
}

function syncOptionalSearchParam(url: URL, key: string, value: string): void {
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
}

function useIsDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return desktop;
}

function toFlowNodes(data: KnowledgeCanvasQueryDto, desktop: boolean): Node[] {
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

function toFlowEdges(data: KnowledgeCanvasQueryDto): Edge[] {
  return data.edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceId,
    target: edge.targetId,
    label: edge.kind,
    style: { stroke: "rgba(148,163,184,0.5)" },
  }));
}

function applyCollapsedBranches(data: KnowledgeCanvasQueryDto, mobileOverrides: Set<string>): KnowledgeCanvasQueryDto {
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

  return {
    ...data,
    nodes: data.nodes.filter((node) => visibleIds.has(node.id)),
    edges: data.edges.filter((edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId)),
    list: data.list.filter((row) => visibleIds.has(row.id)),
  };
}

function applyRelationFilter(data: KnowledgeCanvasQueryDto, relationKind: CanvasRelationKind | ""): KnowledgeCanvasQueryDto {
  if (!relationKind) return data;
  const edges = data.edges.filter((edge) => edge.kind === relationKind);
  const visibleIds = new Set(edges.flatMap((edge) => [edge.sourceId, edge.targetId]));
  return {
    ...data,
    nodes: data.nodes.filter((node) => visibleIds.has(node.id)),
    edges,
    list: data.list.filter((row) => visibleIds.has(row.id)),
  };
}

type LayoutConflictState = {
  action: "save" | "reset";
  latest: Partial<KnowledgeCanvasQueryDto["layout"]> | null;
  conflictFields: string[];
};

function applyLocalLayoutPatches(
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

function overlayPendingLayout(
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
    ...applyLocalLayoutPatches(incoming, relevant),
    layout: {
      ...local.layout,
      ...(viewport ?? {}),
    },
  };
}

function preserveLocalLayout(
  incoming: KnowledgeCanvasQueryDto,
  local: KnowledgeCanvasQueryDto,
): KnowledgeCanvasQueryDto {
  const patches = [...local.nodes, ...local.hiddenNodes].map((node): KnowledgeCanvasNodeLayoutInput => ({
    entityType: node.entityType,
    entityId: node.entityId,
    x: node.x ?? 0,
    y: node.y ?? 0,
    collapsed: node.collapsed,
    pinned: node.pinned,
    hidden: node.hidden,
  }));
  return { ...applyLocalLayoutPatches(incoming, patches), layout: local.layout };
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
  const desktop = useIsDesktop();
  const [canvas, setCanvas] = useState(props.initial);
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
  const [resetOpen, setResetOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [layoutPending, setLayoutPending] = useState(false);
  const [layoutAnnouncement, setLayoutAnnouncement] = useState("");
  const [offline, setOffline] = useState(false);
  const [nodeLimitReached, setNodeLimitReached] = useState(false);
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [layoutConflict, setLayoutConflict] = useState<LayoutConflictState | null>(null);
  const [mobileCollapseOverrides, setMobileCollapseOverrides] = useState<Set<string>>(() => new Set());
  const [viewport, setViewport] = useState<Viewport>(() => ({
    x: props.initial.layout.viewportX,
    y: props.initial.layout.viewportY,
    zoom: props.initial.layout.viewportZoom,
  }));
  const layoutRequestRef = useRef(false);
  const layoutBlockedRef = useRef(false);
  const layoutQueueRef = useRef(createKnowledgeCanvasLayoutQueue());
  const layoutMutationGenerationRef = useRef(0);
  const reloadRequestGenerationRef = useRef(0);
  const canvasRef = useRef(props.initial);
  const desktopRef = useRef(desktop);
  const layoutRevisionRef = useRef(props.initial.layout.revision);
  const lastReloadRef = useRef<{ focus?: string; cursor?: string | null; depth?: number; resetFilters?: boolean }>({});
  const [draggedNodes, setDraggedNodes] = useState<Node[] | null>(null);
  const draggedNodesRef = useRef<Node[] | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState(props.initial.nodes[0]?.id ?? "");
  const [groupTargetId, setGroupTargetId] = useState("");
  const [hiddenTargetId, setHiddenTargetId] = useState(props.initial.hiddenNodes[0]?.id ?? "");
  const hiddenRestoreSelectRef = useRef<HTMLSelectElement>(null);
  const resetLayoutTriggerRef = useRef<HTMLButtonElement>(null);
  const layoutConflictReturnFocusRef = useRef<HTMLElement | null>(null);

  const visibleCanvas = useMemo(
    () => applyRelationFilter(
      applyCollapsedBranches(canvas, desktop ? new Set<string>() : mobileCollapseOverrides),
      relationKindFilter,
    ),
    [canvas, desktop, mobileCollapseOverrides, relationKindFilter],
  );
  const nodes = useMemo(
    () => draggedNodes?.filter((node) => visibleCanvas.nodes.some((visible) => visible.id === node.id)) ?? toFlowNodes(visibleCanvas, desktop),
    [desktop, draggedNodes, visibleCanvas],
  );
  const edges = useMemo(() => toFlowEdges(visibleCanvas), [visibleCanvas]);
  const effectiveSelectedNodeId = visibleCanvas.nodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : visibleCanvas.nodes[0]?.id ?? "";
  const effectiveHiddenTargetId = canvas.hiddenNodes.some((node) => node.id === hiddenTargetId) ? hiddenTargetId : canvas.hiddenNodes[0]?.id ?? "";
  const selectedNode = canvas.nodes.find((node) => node.id === effectiveSelectedNodeId) ?? null;
  const subjectGroups = canvas.nodes.filter((node) => node.entityType === "SUBJECT_GROUP");
  const subjects = canvas.filterOptions.subjects;
  const selectedNodeCollapsed = selectedNode
    ? (!desktop && mobileCollapseOverrides.has(selectedNode.id) ? !selectedNode.collapsed : selectedNode.collapsed)
    : false;
  const lastSyncedLabel = useMemo(
    () => new Date(canvas.syncedAt).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }),
    [canvas.syncedAt],
  );

  useEffect(() => {
    desktopRef.current = desktop;
  }, [desktop]);

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

  function replaceCanvas(next: KnowledgeCanvasQueryDto): void {
    const previous = canvasRef.current;
    const viewportChanged = previous.workspaceId !== next.workspaceId ||
      previous.layout.viewportX !== next.layout.viewportX ||
      previous.layout.viewportY !== next.layout.viewportY ||
      previous.layout.viewportZoom !== next.layout.viewportZoom;
    canvasRef.current = next;
    layoutRevisionRef.current = next.layout.revision;
    if (viewportChanged) {
      const nextViewport = {
        x: next.layout.viewportX,
        y: next.layout.viewportY,
        zoom: next.layout.viewportZoom,
      };
      setViewport((current) =>
        current.x === nextViewport.x && current.y === nextViewport.y && current.zoom === nextViewport.zoom
          ? current
          : nextViewport,
      );
    }
    setCanvas(next);
  }

  function replaceDraggedNodes(next: Node[] | null): void {
    draggedNodesRef.current = next;
    setDraggedNodes(next);
  }

  function syncLayoutDirty(): void {
    setLayoutDirty(hasKnowledgeCanvasLayoutQueueWork(layoutQueueRef.current));
  }

  function focusCanvasNode(nodeId: string) {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`)
          ?.focus({ preventScroll: true });
      });
    });
  }

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
      const response = await fetch(`/api/knowledge-canvas?${search.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        setError(response.status === 409 ? "画布状态已变化，请重试" : "画布加载失败，已保留当前内容");
        return false;
      }
      const body = (await response.json()) as { canvas: KnowledgeCanvasQueryDto };
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
        : preserveLocalLayout(body.canvas, currentBeforeApply);
      if (!params.cursor) {
        const nextCanvas = overlayPendingLayout(incomingCanvas, currentBeforeApply, layoutQueueRef.current);
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

      function mergeById<T extends { id: string }>(left: T[], right: T[]) {
        const merged = new Map(left.map((item) => [item.id, item]));
        for (const item of right) merged.set(item.id, item);
        return [...merged.values()];
      }
      const currentCanvas = canvasRef.current;
      const mergedNodes = mergeById(currentCanvas.nodes, incomingCanvas.nodes);
      if (mergedNodes.length > KNOWLEDGE_CANVAS_MAX_RENDERED_NODES) {
        setNodeLimitReached(true);
        return false;
      }
      const mergedCanvas = overlayPendingLayout({
        ...currentCanvas,
        syncedAt: incomingCanvas.syncedAt,
        depth: incomingCanvas.depth,
        nodes: mergedNodes,
        hiddenNodes: mergeById(currentCanvas.hiddenNodes, incomingCanvas.hiddenNodes),
        edges: mergeById(currentCanvas.edges, incomingCanvas.edges),
        list: mergeById(currentCanvas.list, incomingCanvas.list),
        nextCursor: incomingCanvas.nextCursor,
        truncated: incomingCanvas.truncated,
        graphNodeCount: incomingCanvas.graphNodeCount,
        graphEdgeCount: incomingCanvas.graphEdgeCount,
        pageContextTruncated: currentCanvas.pageContextTruncated || incomingCanvas.pageContextTruncated,
        loadStats: incomingCanvas.loadStats,
        filterOptions: currentCanvas.filterOptions,
        layout: incomingCanvas.layout,
      }, currentCanvas, layoutQueueRef.current);
      replaceCanvas(mergedCanvas);
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

  async function focusBranch(nodeId: string) {
    const loaded = await reload({ focus: nodeId, depth: 1, resetFilters: true });
    if (loaded) focusCanvasNode(nodeId);
  }

  function applyQueuedLayoutLocally(patches: KnowledgeCanvasNodeLayoutInput[]): void {
    const nextCanvas = applyLocalLayoutPatches(canvasRef.current, patches);
    replaceCanvas(nextCanvas);
    replaceDraggedNodes(toFlowNodes(nextCanvas, desktopRef.current));
  }

  function enqueueLayout(patches: KnowledgeCanvasNodeLayoutInput[]): boolean {
    if (!canMutateKnowledgeCanvasLayout({ isDesktopViewport: desktopRef.current }) || patches.length === 0) {
      return false;
    }
    rememberLayoutMutationTrigger();
    applyQueuedLayoutLocally(patches);
    layoutQueueRef.current = enqueueKnowledgeCanvasLayoutPatches(layoutQueueRef.current, patches);
    layoutMutationGenerationRef.current += 1;
    syncLayoutDirty();
    if (!layoutBlockedRef.current) void flushLayoutQueue();
    return true;
  }

  function enqueueViewport(nextViewport: Viewport): boolean {
    if (!canMutateKnowledgeCanvasLayout({ isDesktopViewport: desktopRef.current })) return false;
    rememberLayoutMutationTrigger();
    const patch = {
      viewportX: nextViewport.x,
      viewportY: nextViewport.y,
      viewportZoom: nextViewport.zoom,
    };
    const current = canvasRef.current;
    replaceCanvas({
      ...current,
      layout: { ...current.layout, ...patch, hasSavedLayout: true },
    });
    layoutQueueRef.current = enqueueKnowledgeCanvasViewportPatch(layoutQueueRef.current, patch);
    layoutMutationGenerationRef.current += 1;
    syncLayoutDirty();
    if (!layoutBlockedRef.current) void flushLayoutQueue();
    return true;
  }

  function rememberLayoutMutationTrigger(): void {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== document.body) {
      layoutConflictReturnFocusRef.current = activeElement;
    }
  }

  async function flushLayoutQueue(): Promise<void> {
    if (layoutRequestRef.current || layoutBlockedRef.current || !desktopRef.current) return;
    const started = beginKnowledgeCanvasLayoutSave(layoutQueueRef.current);
    if (started.batch.length === 0 && started.viewport === null) return;
    layoutQueueRef.current = started.state;
    layoutRequestRef.current = true;
    setLayoutPending(true);
    setError(null);
    syncLayoutDirty();
    const requestCanvas = canvasRef.current;
    try {
      const response = await fetch("/api/knowledge-canvas/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: requestCanvas.workspaceId,
          expectedRevision: layoutRevisionRef.current,
          viewportX: started.viewport?.viewportX ?? requestCanvas.layout.viewportX,
          viewportY: started.viewport?.viewportY ?? requestCanvas.layout.viewportY,
          viewportZoom: started.viewport?.viewportZoom ?? requestCanvas.layout.viewportZoom,
          nodes: started.batch,
        }),
      });
      const body = await response.json().catch(() => null) as {
        error?: string;
        layout?: KnowledgeCanvasQueryDto["layout"];
        latest?: Partial<KnowledgeCanvasQueryDto["layout"]>;
        conflictFields?: string[];
      } | null;
      if (response.status === 409) {
        layoutQueueRef.current = restoreKnowledgeCanvasLayoutSave(layoutQueueRef.current);
        layoutBlockedRef.current = true;
        const conflict = {
          action: "save" as const,
          latest: body?.latest ?? null,
          conflictFields: body?.conflictFields ?? ["revision"],
        };
        setLayoutConflict(conflict);
        if (body?.error === "LAYOUT_REVISION_CONFLICT" && typeof body.latest?.revision === "number") {
          const current = canvasRef.current;
          replaceCanvas({
            ...current,
            layout: {
              ...current.layout,
              revision: body.latest.revision,
              hasSavedLayout: true,
            },
          });
        }
        setError(`布局冲突，本地修改已保留（${conflict.conflictFields.join("、")}）`);
        return;
      }
      if (!response.ok || !body?.layout) {
        layoutQueueRef.current = restoreKnowledgeCanvasLayoutSave(layoutQueueRef.current);
        layoutBlockedRef.current = true;
        setError("布局保存失败，本地修改已保留");
        return;
      }
      layoutQueueRef.current = completeKnowledgeCanvasLayoutSave(layoutQueueRef.current);
      const current = canvasRef.current;
      const pendingViewport = layoutQueueRef.current.pendingViewport;
      replaceCanvas({
        ...current,
        layout: {
          ...body.layout,
          ...(pendingViewport ?? {}),
        },
      });
      if (!hasKnowledgeCanvasLayoutQueueWork(layoutQueueRef.current)) {
        const pendingSuffix = "，等待同步";
        setLayoutAnnouncement((current) => current.endsWith(pendingSuffix)
          ? `${current.slice(0, -pendingSuffix.length)}，已同步`
          : "布局已同步");
      }
      setLayoutConflict(null);
      setOffline(false);
    } catch {
      layoutQueueRef.current = restoreKnowledgeCanvasLayoutSave(layoutQueueRef.current);
      layoutBlockedRef.current = true;
      setOffline(!navigator.onLine);
      setError(navigator.onLine ? "布局保存请求失败，本地修改已保留" : "当前离线，布局修改待重试");
    } finally {
      layoutRequestRef.current = false;
      setLayoutPending(false);
      syncLayoutDirty();
    }
    if (!layoutBlockedRef.current && hasKnowledgeCanvasLayoutQueueWork(layoutQueueRef.current)) {
      void flushLayoutQueue();
    }
  }

  function retryLayoutQueue(): void {
    if (!navigator.onLine) {
      setOffline(true);
      setError("当前离线，布局修改仍保留在本地");
      return;
    }
    layoutBlockedRef.current = false;
    setLayoutConflict(null);
    setError(null);
    void flushLayoutQueue();
  }

  async function adoptLatestLayoutConflict(): Promise<void> {
    layoutQueueRef.current = createKnowledgeCanvasLayoutQueue();
    layoutBlockedRef.current = false;
    setLayoutConflict(null);
    setError(null);
    replaceDraggedNodes(null);
    syncLayoutDirty();
    const reloaded = await reload({ focus: canvasRef.current.focusId, depth: 1, resetFilters: true });
    setLayoutAnnouncement(reloaded ? "已采用服务端最新布局，本地冲突修改未应用" : "服务端最新布局重新加载失败，请重试");
    window.requestAnimationFrame(() => resetLayoutTriggerRef.current?.focus({ preventScroll: true }));
  }

  function retryLayoutConflict(): void {
    const action = layoutConflict?.action;
    if (!action) return;
    setLayoutConflict(null);
    setError(null);
    layoutBlockedRef.current = false;
    if (action === "reset") {
      void resetLayout();
      return;
    }
    setLayoutAnnouncement("已使用服务端最新 revision 保留本地布局修改并显式重试");
    void flushLayoutQueue();
  }

  function saveLayout(nextNodes: Node[], changedIds: Set<string>): void {
    const flowById = new Map(nextNodes.map((node) => [node.id, node]));
    const patches = [...changedIds].flatMap((id): KnowledgeCanvasNodeLayoutInput[] => {
      const node = flowById.get(id);
      const current = canvasRef.current.nodes.find((item) => item.id === id);
      if (!node || !current) return [];
      return [{
        entityType: current.entityType,
        entityId: current.entityId,
        x: node.position.x,
        y: node.position.y,
        collapsed: current.collapsed,
        pinned: current.pinned,
        hidden: current.hidden,
      }];
    });
    enqueueLayout(patches);
  }

  async function updateSelectedLayout(
    patch: Partial<Pick<KnowledgeCanvasQueryDto["nodes"][number], "x" | "y" | "collapsed" | "pinned" | "hidden">>,
    announcement: string,
    restoreNodeFocus = false,
  ) {
    if (!selectedNode) return false;
    const current = canvasRef.current.nodes.find((node) => node.id === selectedNode.id);
    if (!current) return false;
    const next = { ...current, ...patch };
    const queued = enqueueLayout([{
      entityType: next.entityType,
      entityId: next.entityId,
      x: next.x ?? 0,
      y: next.y ?? 0,
      collapsed: next.collapsed,
      pinned: next.pinned,
      hidden: next.hidden,
    }]);
    if (!queued) return false;
    if (next.hidden) setHiddenTargetId(next.id);
    setLayoutAnnouncement(announcement);
    if (restoreNodeFocus) focusCanvasNode(next.id);
    return true;
  }

  async function toggleSelectedCollapsed() {
    if (!selectedNode) return;
    if (!desktop) {
      setMobileCollapseOverrides((current) => {
        const next = new Set(current);
        if (next.has(selectedNode.id)) next.delete(selectedNode.id);
        else next.add(selectedNode.id);
        return next;
      });
      setLayoutAnnouncement(`${selectedNode.label}已${selectedNodeCollapsed ? "展开" : "折叠"}，移动端布局未修改`);
      if (selectedNodeCollapsed) await focusBranch(selectedNode.id);
      return;
    }

    const current = canvasRef.current.nodes.find((node) => node.id === selectedNode.id);
    if (!current) return;
    const saved = await updateSelectedLayout(
      { collapsed: !current.collapsed },
      `${current.label}已${current.collapsed ? "展开" : "折叠"}，等待同步`,
      true,
    );
    if (saved && current.collapsed) await focusBranch(current.id);
  }

  async function nudgeSelected(dx: number, dy: number) {
    if (!selectedNode) return;
    const current = canvasRef.current.nodes.find((node) => node.id === selectedNode.id);
    if (!current) return;
    const direction = dx < 0 ? "向左" : dx > 0 ? "向右" : dy < 0 ? "向上" : "向下";
    await updateSelectedLayout(
      { x: (current.x ?? 0) + dx, y: (current.y ?? 0) + dy },
      `${current.label}${direction}移动 24 像素，等待同步`,
      true,
    );
  }

  async function toggleSelectedPinned(): Promise<void> {
    if (!selectedNode) return;
    const current = canvasRef.current.nodes.find((node) => node.id === selectedNode.id);
    if (!current) return;
    await updateSelectedLayout(
      { pinned: !current.pinned },
      `${current.label}已${current.pinned ? "取消固定" : "固定"}，等待同步`,
      true,
    );
  }

  async function hideSelectedNode(): Promise<void> {
    if (!selectedNode) return;
    const saved = await updateSelectedLayout(
      { hidden: true },
      `${selectedNode.label}已隐藏，焦点移至“恢复隐藏对象”，等待同步`,
    );
    if (saved) window.requestAnimationFrame(() => hiddenRestoreSelectRef.current?.focus({ preventScroll: true }));
  }

  function toggleEquivalentView(): void {
    const next = view === "canvas" ? "list" : "canvas";
    setView(next);
    const url = new URL(window.location.href);
    if (next === "list") url.searchParams.set("view", "list");
    else url.searchParams.delete("view");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function autoLayout() {
    const patches: KnowledgeCanvasNodeLayoutInput[] = canvasRef.current.nodes.map((node, index) => ({
      entityType: node.entityType,
      entityId: node.entityId,
      x: (index % 5) * 210,
      y: Math.floor(index / 5) * 120,
      collapsed: node.collapsed,
      pinned: node.pinned,
      hidden: node.hidden,
    }));
    if (!enqueueLayout(patches)) return;
    setLayoutAnnouncement(`已自动排列 ${patches.length} 个对象，等待同步`);
    if (selectedNode) focusCanvasNode(selectedNode.id);
  }

  async function moveSelectedToGroup() {
    const target = canvasRef.current.nodes.find((node) => node.id === groupTargetId);
    if (!selectedNode || !target) return;
    await updateSelectedLayout(
      { x: (target.x ?? 0) + 190, y: target.y ?? 0 },
      `${selectedNode.label}已移动到${target.label}真实分组，等待同步`,
      true,
    );
  }

  async function restoreHiddenNode() {
    const target = canvasRef.current.hiddenNodes.find((node) => node.id === effectiveHiddenTargetId);
    if (!target) return;
    if (!enqueueLayout([{
      entityType: target.entityType,
      entityId: target.entityId,
      x: target.x ?? 0,
      y: target.y ?? 0,
      collapsed: target.collapsed,
      pinned: target.pinned,
      hidden: false,
    }])) return;
    setSelectedNodeId(target.id);
    setLayoutAnnouncement(`${target.label}已恢复到画布，等待同步`);
    focusCanvasNode(target.id);
  }

  function onNodesChange(changes: NodeChange[]): void {
    const base = draggedNodesRef.current ?? toFlowNodes(canvasRef.current, desktopRef.current);
    const next = applyNodeChanges(changes, base);
    replaceDraggedNodes(next);
    const changedIds = new Set(changes.flatMap((change) =>
      change.type === "position" && change.dragging === false ? [change.id] : [],
    ));
    if (changedIds.size > 0) saveLayout(next, changedIds);
  }

  async function resetLayout() {
    if (
      layoutRequestRef.current ||
      hasKnowledgeCanvasLayoutQueueWork(layoutQueueRef.current)
    ) {
      setError("请先同步待保存的布局修改，再重置布局");
      return;
    }
    const requestCanvas = canvasRef.current;
    try {
      const response = await fetch("/api/knowledge-canvas/layout", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: requestCanvas.workspaceId,
          expectedRevision: layoutRevisionRef.current,
        }),
      });
      const body = await response.json().catch(() => null) as {
        layout?: KnowledgeCanvasQueryDto["layout"];
        latest?: Partial<KnowledgeCanvasQueryDto["layout"]>;
        conflictFields?: string[];
      } | null;
      if (!response.ok) {
        if (response.status === 409) {
          layoutConflictReturnFocusRef.current = resetLayoutTriggerRef.current;
          setLayoutConflict({
            action: "reset",
            latest: body?.latest ?? null,
            conflictFields: body?.conflictFields ?? ["revision"],
          });
          if (typeof body?.latest?.revision === "number") {
            replaceCanvas({
              ...canvasRef.current,
              layout: { ...canvasRef.current.layout, ...body.latest, revision: body.latest.revision },
            });
          }
        }
        if (response.status === 409) setResetOpen(false);
        setError(response.status === 409 ? "布局已在其他设备更新，未执行重置" : "重置布局失败");
        return;
      }
      if (body?.layout) {
        layoutMutationGenerationRef.current += 1;
        replaceCanvas({ ...canvasRef.current, layout: body.layout });
      }
      setLayoutConflict(null);
      setOffline(false);
      setError(null);
      setLayoutAnnouncement("画布布局已重置，焦点返回“重置布局”");
      setResetOpen(false);
      replaceDraggedNodes(null);
      startTransition(() => {
        void reload({ focus: requestCanvas.focusId, depth: 1, resetFilters: true });
      });
    } catch {
      setOffline(!navigator.onLine);
      setError(navigator.onLine ? "重置布局请求失败" : "当前离线，布局未重置");
    }
  }

  const listRows = useMemo(() => visibleCanvas.list, [visibleCanvas.list]);
  const relationLabelsByNode = useMemo(() => {
    const labels = new Map<string, Set<string>>();
    for (const edge of visibleCanvas.edges) {
      for (const id of [edge.sourceId, edge.targetId]) {
        const values = labels.get(id) ?? new Set<string>();
        values.add(relationKindLabels[edge.kind]);
        labels.set(id, values);
      }
    }
    return labels;
  }, [visibleCanvas.edges]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-white">关联画布</h1>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap gap-2">
          <input
            aria-label="搜索画布节点"
            className="min-w-[12rem] flex-1 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
            placeholder="搜索节点"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void reload({ focus: canvas.focusId, depth: canvas.depth });
            }}
          />
          <select
            aria-label="按类型筛选"
            className="h-10 rounded-md border border-white/10 bg-black/30 px-2 text-sm"
            value={entityTypeFilter}
            onChange={(event) => setEntityTypeFilter(event.target.value)}
          >
            <option value="">全部类型</option>
            {KNOWLEDGE_CANVAS_ENTITY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <select
            aria-label="按科目筛选"
            className="h-10 rounded-md border border-white/10 bg-black/30 px-2 text-sm"
            value={subjectFilter}
            onChange={(event) => setSubjectFilter(event.target.value)}
          >
            <option value="">全部科目</option>
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.label}</option>)}
          </select>
          <select
            aria-label="按关系筛选"
            className="h-10 rounded-md border border-white/10 bg-black/30 px-2 text-sm"
            value={relationKindFilter}
            onChange={(event) => setRelationKindFilter(event.target.value as CanvasRelationKind | "")}
          >
            <option value="">全部关系</option>
            {(Object.keys(relationKindLabels) as CanvasRelationKind[]).map((kind) => (
              <option key={kind} value={kind}>{relationKindLabels[kind]}</option>
            ))}
          </select>
          <select
            aria-label="按状态筛选"
            className="h-10 rounded-md border border-white/10 bg-black/30 px-2 text-sm"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "active" | "all")}
          >
            <option value="active">进行中</option>
            <option value="all">全部状态</option>
          </select>
          <button
            type="button"
            className="h-10 rounded-md border border-white/10 px-3 text-sm hover:bg-white/5"
            onClick={() => void reload({ focus: canvas.focusId, depth: canvas.depth })}
          >
            应用筛选
          </button>
          <button
            type="button"
            className="rounded-md border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
            onClick={() => void reload({ focus: canvas.focusId, depth: Math.min(4, (canvas.depth || 1) + 1) })}
          >
            展开一层
          </button>
          <button
            type="button"
            className="rounded-md border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
            onClick={toggleEquivalentView}
          >
            {view === "canvas" ? "等价列表" : "画布视图"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md bg-teal-500/20 px-3 py-2 text-sm text-teal-100 hover:bg-teal-500/30"
            onClick={() => setCreateOpen(true)}
          >
            快捷创建
          </button>
          {canMutateKnowledgeCanvasLayout({ isDesktopViewport: desktop }) ? (
            <button
              ref={resetLayoutTriggerRef}
              type="button"
              className="rounded-md border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
              disabled={layoutDirty || layoutPending}
              onClick={() => setResetOpen(true)}
            >
              重置布局
            </button>
          ) : null}
        </div>
      </div>

      <section className="grid min-w-0 gap-3 rounded-md border border-white/10 bg-[#101419] p-3 lg:grid-cols-[minmax(14rem,1fr)_auto_minmax(14rem,1fr)]" aria-label="画布布局命令">
        <p className="sr-only" role="status" aria-live="polite">{layoutAnnouncement}</p>
        <label className="grid min-w-0 gap-1 text-xs text-zinc-400">
          画布焦点对象
          <select aria-label="画布焦点对象" className="h-10 w-full min-w-0 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100" value={effectiveSelectedNodeId} onChange={(event) => setSelectedNodeId(event.target.value)} disabled={layoutPending || visibleCanvas.nodes.length === 0}>
            {visibleCanvas.nodes.map((node) => <option key={node.id} value={node.id}>{node.label} · {node.entityType}</option>)}
          </select>
        </label>
        <div
          className="grid grid-cols-3 gap-1 self-end justify-self-start rounded-md border border-white/10 p-1 lg:justify-self-center"
          tabIndex={0}
          aria-label="画布布局键盘命令"
          onKeyDown={(event) => {
            const delta = event.key === "ArrowLeft" ? [-24, 0] : event.key === "ArrowRight" ? [24, 0] : event.key === "ArrowUp" ? [0, -24] : event.key === "ArrowDown" ? [0, 24] : null;
            if (!delta || !desktop) return;
            event.preventDefault();
            void nudgeSelected(delta[0], delta[1]);
          }}
        >
          <span />
          <button type="button" title="向上微调" aria-label="向上微调" className="grid h-9 w-9 place-items-center rounded border border-white/10" disabled={!desktop || !selectedNode} onClick={() => void nudgeSelected(0, -24)}><ArrowUp size={16} aria-hidden="true" /></button>
          <span />
          <button type="button" title="向左微调" aria-label="向左微调" className="grid h-9 w-9 place-items-center rounded border border-white/10" disabled={!desktop || !selectedNode} onClick={() => void nudgeSelected(-24, 0)}><ArrowLeft size={16} aria-hidden="true" /></button>
          <button type="button" title="向下微调" aria-label="向下微调" className="grid h-9 w-9 place-items-center rounded border border-white/10" disabled={!desktop || !selectedNode} onClick={() => void nudgeSelected(0, 24)}><ArrowDown size={16} aria-hidden="true" /></button>
          <button type="button" title="向右微调" aria-label="向右微调" className="grid h-9 w-9 place-items-center rounded border border-white/10" disabled={!desktop || !selectedNode} onClick={() => void nudgeSelected(24, 0)}><ArrowRight size={16} aria-hidden="true" /></button>
        </div>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-1">
          <label className="grid min-w-0 gap-1 text-xs text-zinc-400">
            移动到真实分组
            <select aria-label="移动到真实分组" className="h-10 w-full min-w-0 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100" value={groupTargetId} onChange={(event) => setGroupTargetId(event.target.value)} disabled={!desktop || subjectGroups.length === 0}>
              <option value="">选择分组</option>
              {subjectGroups.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-2 self-end">
            <button type="button" title="自动布局" aria-label="自动布局" className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm" disabled={!desktop || canvas.nodes.length === 0} onClick={() => void autoLayout()}><WandSparkles size={16} aria-hidden="true" />自动布局</button>
            <button type="button" title={selectedNode?.pinned ? "取消固定" : "固定对象"} aria-label={selectedNode?.pinned ? "取消固定" : "固定对象"} className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm" disabled={!desktop || !selectedNode} onClick={() => void toggleSelectedPinned()}>{selectedNode?.pinned ? <PinOff size={16} aria-hidden="true" /> : <Pin size={16} aria-hidden="true" />}{selectedNode?.pinned ? "取消固定" : "固定"}</button>
            <button type="button" title="移动到真实分组" aria-label="移动到真实分组" className="h-10 rounded-md border border-white/10 px-3 text-sm" disabled={!desktop || !selectedNode || !groupTargetId} onClick={() => void moveSelectedToGroup()}>移动</button>
            <button type="button" title="隐藏对象" aria-label="隐藏对象" className="grid h-10 w-10 place-items-center rounded-md border border-white/10" disabled={!desktop || !selectedNode} onClick={() => void hideSelectedNode()}><EyeOff size={16} aria-hidden="true" /></button>
          </div>
          {canvas.hiddenNodes.length > 0 ? (
            <div className="flex gap-2">
              <select ref={hiddenRestoreSelectRef} aria-label="恢复隐藏对象" className="h-10 min-w-0 flex-1 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100" value={effectiveHiddenTargetId} onChange={(event) => setHiddenTargetId(event.target.value)} disabled={!desktop}>
                {canvas.hiddenNodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
              </select>
              <button type="button" title="恢复隐藏对象" aria-label="恢复隐藏对象" className="grid h-10 w-10 place-items-center rounded-md border border-white/10" disabled={!desktop || !effectiveHiddenTargetId} onClick={() => void restoreHiddenNode()}><Eye size={16} aria-hidden="true" /></button>
            </div>
          ) : null}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2" aria-label="当前对象操作">
        <button
          type="button"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm hover:bg-white/5"
          disabled={!selectedNode || loading}
          onClick={() => selectedNode && void focusBranch(selectedNode.id)}
        >
          <Focus size={16} aria-hidden="true" />聚焦分支
        </button>
        <button
          type="button"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm hover:bg-white/5"
          disabled={!selectedNode || loading}
          onClick={() => void toggleSelectedCollapsed()}
        >
          {selectedNodeCollapsed ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
          {selectedNodeCollapsed ? "展开" : "折叠"}
        </button>
        {selectedNode?.href ? (
          <Link className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500/20 px-3 text-sm text-teal-100 hover:bg-teal-500/30" href={selectedNode.href}>
            <ExternalLink size={16} aria-hidden="true" />打开当前对象
          </Link>
        ) : null}
        <span className="text-xs text-zinc-500">当前聚焦：{canvas.nodes.find((node) => node.id === canvas.focusId)?.label ?? "考试工作区"}</span>
      </div>

      {!desktop ? (
        <p className="text-xs text-zinc-500" role="status">
          移动端可搜索、平移、缩放与打开详情；布局编辑仅桌面可用。
        </p>
      ) : null}
      {offline || error ? (
        <div className="flex items-center gap-3 border-l-2 border-amber-400 bg-amber-400/5 px-3 py-2 text-sm text-amber-200" role={error ? "alert" : "status"}>
          {offline ? <WifiOff size={16} aria-hidden="true" /> : null}
          <div className="min-w-0 flex-1">
            <p>{error ?? "当前离线"} · 上次同步于 {lastSyncedLabel}</p>
            {layoutDirty ? <p className="mt-1 text-xs">本地布局 patch 已保留，重试不会重新加载画布。</p> : null}
            {layoutConflict ? (
              <p className="mt-1 text-xs">
                服务端 revision {layoutConflict.latest?.revision ?? "未知"}；冲突字段：{layoutConflict.conflictFields.join("、")}。
              </p>
            ) : null}
          </div>
          <button
            type="button"
            title={layoutDirty ? "重试保存本地布局" : "重试画布请求"}
            aria-label={layoutDirty ? "重试保存本地布局" : "重试画布请求"}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-amber-300/30"
            disabled={loading || layoutPending}
            onClick={() => layoutDirty ? retryLayoutQueue() : void reload(lastReloadRef.current)}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <p className="text-xs text-zinc-500" role="status">
          {layoutDirty ? (layoutPending ? "布局修改正在同步" : "布局修改等待重试") : `上次同步于 ${lastSyncedLabel}`}
        </p>
      )}
      {nodeLimitReached ? (
        <p className="text-sm text-amber-300" role="status">当前视图已达到 500 个对象上限，请聚焦分支或缩小筛选范围。</p>
      ) : null}
      {canvas.pageContextTruncated ? (
        <p className="text-sm text-amber-300" role="status">当前对象的关系上下文超过单页容量；请聚焦该对象继续查看。</p>
      ) : null}
      {pending || loading ? <p className="text-xs text-zinc-500">刷新中…</p> : null}

      {view === "list" ? (
        <ul className="divide-y divide-white/10 rounded-md border border-white/10" aria-label="画布等价列表">
          {listRows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="text-zinc-100">{row.label}</p>
                <p className="text-xs text-zinc-500">
                  {row.entityType}
                  {relationLabelsByNode.get(row.id)?.size
                    ? ` · ${[...relationLabelsByNode.get(row.id)!].join("、")}`
                    : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" className="text-zinc-300 hover:text-white" onClick={() => void focusBranch(row.id)}>聚焦</button>
                {row.href ? (
                  <ListDetailLink className="text-teal-300 hover:underline" href={row.href} focusId={`canvas-row-${row.id}`}>打开</ListDetailLink>
                ) : null}
              </div>
            </li>
          ))}
          {listRows.length === 0 ? <li className="px-3 py-6 text-sm text-zinc-500">当前筛选无节点。</li> : null}
        </ul>
      ) : (
        <div className="h-[min(70vh,640px)] overflow-hidden rounded-md border border-white/10 bg-[#0b1017]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={
              canMutateKnowledgeCanvasLayout({ isDesktopViewport: desktop }) ? onNodesChange : undefined
            }
            nodesDraggable={canMutateKnowledgeCanvasLayout({ isDesktopViewport: desktop })}
            viewport={viewport}
            onViewportChange={setViewport}
            onMoveEnd={(event, nextViewport) => {
              if (event) enqueueViewport(nextViewport);
            }}
            onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
            onNodeDoubleClick={(_event, node) => void focusBranch(node.id)}
            fitView={!canvas.layout.hasSavedLayout}
            proOptions={{ hideAttribution: true }}
            aria-label="知识关联画布"
          >
            <Background gap={18} size={1} color="rgba(255,255,255,0.06)" />
            <Controls />
            {canMutateKnowledgeCanvasLayout({ isDesktopViewport: desktop }) ? <MiniMap pannable zoomable /> : null}
          </ReactFlow>
        </div>
      )}

      {canvas.truncated && canvas.nextCursor && !nodeLimitReached ? (
        <button
          type="button"
          className="text-sm text-teal-300 hover:underline"
          onClick={() => void reload({ focus: canvas.focusId, cursor: canvas.nextCursor, depth: canvas.depth })}
        >
          继续加载下一页
        </button>
      ) : null}

      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="快捷创建">
        <div className="space-y-3 text-sm">
          <p className="text-zinc-400">创建后进入对应工作台表单；对象写入真实表，画布重新派生。</p>
          <Link className="block rounded-md border border-white/10 px-3 py-2 hover:bg-white/5" href="/knowledge/notes">
            创建知识卡片
          </Link>
          <Link className="block rounded-md border border-white/10 px-3 py-2 hover:bg-white/5" href="/knowledge/mistakes">
            创建错题
          </Link>
          <Link className="block rounded-md border border-white/10 px-3 py-2 hover:bg-white/5" href="/knowledge/resources">
            创建资料
          </Link>
          <Link className="block rounded-md border border-white/10 px-3 py-2 hover:bg-white/5" href="/plan">
            创建任务
          </Link>
        </div>
      </Drawer>

      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="重置个人布局？">
        <p className="text-sm text-zinc-400">只清除视口与节点位置偏好，不会删除业务对象或关系。</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded-md border border-white/10 px-3 py-2 text-sm" onClick={() => setResetOpen(false)}>
            取消
          </button>
          <button type="button" className="rounded-md bg-amber-500/20 px-3 py-2 text-sm text-amber-100" disabled={layoutDirty || layoutPending} onClick={() => void resetLayout()}>
            确认重置
          </button>
        </div>
      </Modal>

      <Modal
        open={layoutConflict !== null}
        title="布局已在其他设备更新"
        allowEscape={false}
        returnFocusRef={layoutConflictReturnFocusRef}
      >
        <div className="space-y-3 text-sm text-zinc-300">
          <p>
            服务端 revision {layoutConflict?.latest?.revision ?? "未知"}；冲突字段：
            {layoutConflict?.conflictFields.join("、") ?? "revision"}。本地修改仍保留，系统不会强制覆盖。
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-white/10 px-3 py-2 text-sm"
              onClick={() => void adoptLatestLayoutConflict()}
            >
              采用服务端布局
            </button>
            <button
              type="button"
              className="rounded-md bg-teal-500/20 px-3 py-2 text-sm text-teal-100"
              onClick={retryLayoutConflict}
            >
              {layoutConflict?.action === "reset" ? "使用最新状态重试重置" : "保留本地修改并重试"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
