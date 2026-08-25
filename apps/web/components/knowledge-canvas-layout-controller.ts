import {
  beginKnowledgeCanvasLayoutSave,
  canMutateKnowledgeCanvasLayout,
  completeKnowledgeCanvasLayoutSave,
  createKnowledgeCanvasLayoutQueue,
  enqueueKnowledgeCanvasLayoutPatches,
  enqueueKnowledgeCanvasViewportPatch,
  hasKnowledgeCanvasLayoutQueueWork,
  restoreKnowledgeCanvasLayoutSave,
  type KnowledgeCanvasNodeLayoutInput,
} from "@areaforge/core";
import { applyKnowledgeCanvasLayoutPatches } from "@/lib/knowledge/canvas-projection";
import {
  applyKnowledgeCanvasViewport,
  createKnowledgeCanvasAutoLayout,
  createKnowledgeCanvasFlowLayoutPatches,
  createKnowledgeCanvasNodeLayoutPatch,
  knowledgeCanvasViewport,
  knowledgeCanvasViewportChanged,
  toKnowledgeCanvasFlowNodes,
  toKnowledgeCanvasViewportInput,
} from "@/lib/knowledge/canvas-layout";
import {
  resetKnowledgeCanvasLayout as requestKnowledgeCanvasLayoutReset,
  saveKnowledgeCanvasLayout as requestKnowledgeCanvasLayoutSave,
} from "@/lib/api/knowledge-canvas";
import { isConflict } from "@/lib/client/api-errors";
import type { KnowledgeCanvasQueryDto } from "@/lib/contracts";
import { applyNodeChanges, type Node, type NodeChange, type Viewport } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { focusKnowledgeCanvasNode } from "@/components/knowledge-canvas-focus";

export interface KnowledgeCanvasReloadParams {
  focus?: string;
  cursor?: string | null;
  depth?: number;
  resetFilters?: boolean;
}

export type KnowledgeCanvasReload = (params?: KnowledgeCanvasReloadParams) => Promise<boolean>;

export type LayoutConflictState = {
  action: "save" | "reset";
  latest: Partial<KnowledgeCanvasQueryDto["layout"]> | null;
  conflictFields: string[];
};

export function useKnowledgeCanvasLayoutController({
  initial,
  desktop,
  reload,
  setError,
  setOffline,
  startTransition,
}: {
  initial: KnowledgeCanvasQueryDto;
  desktop: boolean;
  reload: KnowledgeCanvasReload;
  setError: (value: string | null) => void;
  setOffline: (value: boolean) => void;
  startTransition: (callback: () => void) => void;
}) {
  const [canvas, setCanvas] = useState(initial);
  const [layoutPending, setLayoutPending] = useState(false);
  const [layoutAnnouncement, setLayoutAnnouncement] = useState("");
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [layoutConflict, setLayoutConflict] = useState<LayoutConflictState | null>(null);
  const [mobileCollapseOverrides, setMobileCollapseOverrides] = useState<Set<string>>(() => new Set());
  const [viewport, setViewport] = useState<Viewport>(() => knowledgeCanvasViewport(initial.layout));
  const [draggedNodes, setDraggedNodes] = useState<Node[] | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState(initial.nodes[0]?.id ?? "");
  const [groupTargetId, setGroupTargetId] = useState("");
  const [hiddenTargetId, setHiddenTargetId] = useState(initial.hiddenNodes[0]?.id ?? "");
  const [resetOpen, setResetOpen] = useState(false);
  const layoutRequestRef = useRef(false);
  const layoutBlockedRef = useRef(false);
  const layoutQueueRef = useRef(createKnowledgeCanvasLayoutQueue());
  const layoutMutationGenerationRef = useRef(0);
  const canvasRef = useRef(initial);
  const desktopRef = useRef(desktop);
  const layoutRevisionRef = useRef(initial.layout.revision);
  const draggedNodesRef = useRef<Node[] | null>(null);
  const hiddenRestoreSelectRef = useRef<HTMLSelectElement>(null);
  const resetLayoutTriggerRef = useRef<HTMLButtonElement>(null);
  const layoutConflictReturnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    desktopRef.current = desktop;
  }, [desktop]);

  function replaceCanvas(next: KnowledgeCanvasQueryDto): void {
    const previous = canvasRef.current;
    const viewportChanged = knowledgeCanvasViewportChanged(previous, next);
    canvasRef.current = next;
    layoutRevisionRef.current = next.layout.revision;
    if (viewportChanged) {
      const nextViewport = knowledgeCanvasViewport(next.layout);
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

  async function focusBranch(nodeId: string) {
    const loaded = await reload({ focus: nodeId, depth: 1, resetFilters: true });
    if (loaded) focusKnowledgeCanvasNode(nodeId);
  }

  function applyQueuedLayoutLocally(patches: KnowledgeCanvasNodeLayoutInput[]): void {
    const nextCanvas = applyKnowledgeCanvasLayoutPatches(canvasRef.current, patches);
    replaceCanvas(nextCanvas);
    replaceDraggedNodes(toKnowledgeCanvasFlowNodes(nextCanvas, desktopRef.current));
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
    const patch = toKnowledgeCanvasViewportInput(nextViewport);
    replaceCanvas(applyKnowledgeCanvasViewport(canvasRef.current, patch));
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
      const result = await requestKnowledgeCanvasLayoutSave({
        workspaceId: requestCanvas.workspaceId,
        expectedRevision: layoutRevisionRef.current,
        viewportX: started.viewport?.viewportX ?? requestCanvas.layout.viewportX,
        viewportY: started.viewport?.viewportY ?? requestCanvas.layout.viewportY,
        viewportZoom: started.viewport?.viewportZoom ?? requestCanvas.layout.viewportZoom,
        nodes: started.batch,
      });
      const body = result.body;
      if (isConflict(result)) {
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
      if (!result.ok || !body?.layout) {
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
    enqueueLayout(createKnowledgeCanvasFlowLayoutPatches(canvasRef.current, nextNodes, changedIds));
  }

  async function updateNodeLayout(
    node: KnowledgeCanvasQueryDto["nodes"][number],
    patch: Partial<Pick<KnowledgeCanvasQueryDto["nodes"][number], "x" | "y" | "collapsed" | "pinned" | "hidden">>,
    announcement: string,
    restoreNodeFocus = false,
  ) {
    const current = canvasRef.current.nodes.find((candidate) => candidate.id === node.id);
    if (!current) return false;
    const next = { ...current, ...patch };
    const queued = enqueueLayout([createKnowledgeCanvasNodeLayoutPatch(current, patch)]);
    if (!queued) return false;
    if (next.hidden) setHiddenTargetId(next.id);
    setLayoutAnnouncement(announcement);
    if (restoreNodeFocus) focusKnowledgeCanvasNode(next.id);
    return true;
  }

  async function toggleSelectedCollapsed(
    selectedNode: KnowledgeCanvasQueryDto["nodes"][number] | null,
    selectedNodeCollapsed: boolean,
  ) {
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
    const saved = await updateNodeLayout(
      current,
      { collapsed: !current.collapsed },
      `${current.label}已${current.collapsed ? "展开" : "折叠"}，等待同步`,
      true,
    );
    if (saved && current.collapsed) await focusBranch(current.id);
  }

  async function nudgeSelected(
    selectedNode: KnowledgeCanvasQueryDto["nodes"][number] | null,
    dx: number,
    dy: number,
  ) {
    if (!selectedNode) return;
    const current = canvasRef.current.nodes.find((node) => node.id === selectedNode.id);
    if (!current) return;
    const direction = dx < 0 ? "向左" : dx > 0 ? "向右" : dy < 0 ? "向上" : "向下";
    await updateNodeLayout(
      current,
      { x: (current.x ?? 0) + dx, y: (current.y ?? 0) + dy },
      `${current.label}${direction}移动 24 像素，等待同步`,
      true,
    );
  }

  async function toggleSelectedPinned(selectedNode: KnowledgeCanvasQueryDto["nodes"][number] | null) {
    if (!selectedNode) return;
    const current = canvasRef.current.nodes.find((node) => node.id === selectedNode.id);
    if (!current) return;
    await updateNodeLayout(
      current,
      { pinned: !current.pinned },
      `${current.label}已${current.pinned ? "取消固定" : "固定"}，等待同步`,
      true,
    );
  }

  async function hideSelectedNode(selectedNode: KnowledgeCanvasQueryDto["nodes"][number] | null) {
    if (!selectedNode) return;
    const saved = await updateNodeLayout(
      selectedNode,
      { hidden: true },
      `${selectedNode.label}已隐藏，焦点移至“恢复隐藏对象”，等待同步`,
    );
    if (saved) window.requestAnimationFrame(() => hiddenRestoreSelectRef.current?.focus({ preventScroll: true }));
  }

  async function autoLayout() {
    const patches = createKnowledgeCanvasAutoLayout(canvasRef.current.nodes);
    if (!enqueueLayout(patches)) return;
    setLayoutAnnouncement(`已自动排列 ${patches.length} 个对象，等待同步`);
    const selectedNode = canvasRef.current.nodes.find((node) => node.id === selectedNodeId);
    if (selectedNode) focusKnowledgeCanvasNode(selectedNode.id);
  }

  async function moveSelectedToGroup(
    selectedNode: KnowledgeCanvasQueryDto["nodes"][number] | null,
    targetId: string,
  ) {
    const target = canvasRef.current.nodes.find((node) => node.id === targetId);
    if (!selectedNode || !target) return;
    await updateNodeLayout(
      selectedNode,
      { x: (target.x ?? 0) + 190, y: target.y ?? 0 },
      `${selectedNode.label}已移动到${target.label}真实分组，等待同步`,
      true,
    );
  }

  async function restoreHiddenNode(targetId: string) {
    const target = canvasRef.current.hiddenNodes.find((node) => node.id === targetId);
    if (!target) return;
    if (!enqueueLayout([createKnowledgeCanvasNodeLayoutPatch(target, { hidden: false })])) return;
    setSelectedNodeId(target.id);
    setLayoutAnnouncement(`${target.label}已恢复到画布，等待同步`);
    focusKnowledgeCanvasNode(target.id);
  }

  function onNodesChange(changes: NodeChange[]): void {
    const base = draggedNodesRef.current ?? toKnowledgeCanvasFlowNodes(canvasRef.current, desktopRef.current);
    const next = applyNodeChanges(changes, base);
    replaceDraggedNodes(next);
    const changedIds = new Set(changes.flatMap((change) =>
      change.type === "position" && change.dragging === false ? [change.id] : [],
    ));
    if (changedIds.size > 0) saveLayout(next, changedIds);
  }

  async function resetLayout() {
    if (layoutRequestRef.current || hasKnowledgeCanvasLayoutQueueWork(layoutQueueRef.current)) {
      setError("请先同步待保存的布局修改，再重置布局");
      return;
    }
    const requestCanvas = canvasRef.current;
    try {
      const result = await requestKnowledgeCanvasLayoutReset({
        workspaceId: requestCanvas.workspaceId,
        expectedRevision: layoutRevisionRef.current,
      });
      const body = result.body;
      if (!result.ok) {
        if (isConflict(result)) {
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
        if (isConflict(result)) setResetOpen(false);
        setError(isConflict(result) ? "布局已在其他设备更新，未执行重置" : "重置布局失败");
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

  return {
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
    syncLayoutDirty,
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
    toggleSelectedCollapsed,
    nudgeSelected,
    toggleSelectedPinned,
    hideSelectedNode,
    autoLayout,
    moveSelectedToGroup,
    restoreHiddenNode,
    onNodesChange,
    resetLayout,
  };
}
