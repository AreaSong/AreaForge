"use client";

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Eye, EyeOff, Pin, PinOff, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Node,
  type Edge,
  type NodeChange,
  applyNodeChanges,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { canMutateKnowledgeCanvasLayout, KNOWLEDGE_CANVAS_ENTITY_TYPES } from "@areaforge/core";
import type { KnowledgeCanvasQueryDto } from "@/lib/study/knowledge-canvas-service";
import { Drawer, Modal } from "@/components/ui/overlays";
import { updateKnowledgeContext } from "@/lib/client/knowledge-context";

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

export function KnowledgeCanvasClient(props: { initial: KnowledgeCanvasQueryDto; initialQuery?: string }) {
  const desktop = useIsDesktop();
  const [canvas, setCanvas] = useState(props.initial);
  const [query, setQuery] = useState(props.initialQuery ?? "");
  const [entityTypeFilter, setEntityTypeFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [view, setView] = useState<"canvas" | "list">("canvas");
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [layoutPending, setLayoutPending] = useState(false);
  const [layoutAnnouncement, setLayoutAnnouncement] = useState("");
  const layoutRequestRef = useRef(false);
  const [draggedNodes, setDraggedNodes] = useState<Node[] | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState(props.initial.nodes[0]?.id ?? "");
  const [groupTargetId, setGroupTargetId] = useState("");
  const [hiddenTargetId, setHiddenTargetId] = useState(props.initial.hiddenNodes[0]?.id ?? "");

  const nodes = useMemo(
    () => draggedNodes ?? toFlowNodes(canvas, desktop),
    [canvas, desktop, draggedNodes],
  );
  const edges = useMemo(() => toFlowEdges(canvas), [canvas]);
  const effectiveSelectedNodeId = canvas.nodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : canvas.nodes[0]?.id ?? "";
  const effectiveHiddenTargetId = canvas.hiddenNodes.some((node) => node.id === hiddenTargetId) ? hiddenTargetId : canvas.hiddenNodes[0]?.id ?? "";
  const selectedNode = canvas.nodes.find((node) => node.id === effectiveSelectedNodeId) ?? null;
  const subjectGroups = canvas.nodes.filter((node) => node.entityType === "SUBJECT_GROUP");
  const subjects = canvas.filterOptions.subjects;

  function focusCanvasNode(nodeId: string) {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`)?.focus();
    });
  }

  async function reload(params?: { focus?: string; cursor?: string | null; depth?: number }) {
    setError(null);
    const search = new URLSearchParams();
    search.set("workspaceId", canvas.workspaceId);
    search.set("depth", String(params?.depth ?? canvas.depth ?? 1));
    if (params?.focus) search.set("focus", params.focus);
    if (params?.cursor) search.set("cursor", params.cursor);
    if (query.trim()) search.set("q", query.trim());
    if (entityTypeFilter) search.set("entityType", entityTypeFilter);
    if (subjectFilter) search.set("subjectId", subjectFilter);
    search.set("status", statusFilter);
    const response = await fetch(`/api/knowledge-canvas?${search.toString()}`);
    if (!response.ok) {
      setError("画布加载失败");
      return;
    }
    const body = (await response.json()) as { canvas: KnowledgeCanvasQueryDto };
    updateKnowledgeContext({ workspaceId: canvas.workspaceId, q: query.trim() || null });
    setDraggedNodes(null);
    if (!params?.cursor) {
      setCanvas(body.canvas);
      return;
    }
    setCanvas((current) => {
      function mergeById<T extends { id: string }>(left: T[], right: T[]) {
        const merged = new Map(left.map((item) => [item.id, item]));
        for (const item of right) merged.set(item.id, item);
        return [...merged.values()];
      }
      return {
        ...current,
        focusId: current.focusId || body.canvas.focusId,
        depth: body.canvas.depth,
        nodes: mergeById(current.nodes, body.canvas.nodes),
        hiddenNodes: mergeById(current.hiddenNodes, body.canvas.hiddenNodes),
        edges: mergeById(current.edges, body.canvas.edges),
        list: mergeById(current.list, body.canvas.list),
        nextCursor: body.canvas.nextCursor,
        truncated: body.canvas.truncated,
        filterOptions: current.filterOptions,
        layout: body.canvas.layout,
      };
    });
  }

  async function persistLayout(nextNodes: Array<{
    entityType: KnowledgeCanvasQueryDto["nodes"][number]["entityType"];
    entityId: string;
    x: number;
    y: number;
    collapsed?: boolean;
    pinned?: boolean;
    hidden?: boolean;
  }>) {
    if (!canMutateKnowledgeCanvasLayout({ isDesktopViewport: desktop }) || layoutRequestRef.current) return;
    layoutRequestRef.current = true;
    setLayoutPending(true);
    setError(null);
    try {
      const response = await fetch("/api/knowledge-canvas/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: canvas.workspaceId,
          expectedRevision: canvas.layout.revision,
          viewportX: canvas.layout.viewportX,
          viewportY: canvas.layout.viewportY,
          viewportZoom: canvas.layout.viewportZoom,
          nodes: nextNodes,
        }),
      });
      if (response.status === 409) {
        setError("布局已被其他设备更新，请刷新后重试");
        return;
      }
      if (!response.ok) {
        setError("布局保存失败");
        return;
      }
      const body = (await response.json()) as { layout: KnowledgeCanvasQueryDto["layout"] };
      setCanvas((prev) => ({ ...prev, layout: body.layout }));
      return body.layout;
    } finally {
      layoutRequestRef.current = false;
      setLayoutPending(false);
    }
  }

  async function saveLayout(nextNodes: Node[]) {
    await persistLayout(nextNodes.map((node) => {
      const current = canvas.nodes.find((item) => item.id === node.id);
      const [entityType, entityId] = node.id.split(":") as [KnowledgeCanvasQueryDto["nodes"][number]["entityType"], string];
      return {
        entityType,
        entityId,
        x: node.position.x,
        y: node.position.y,
        collapsed: current?.collapsed ?? false,
        pinned: current?.pinned ?? false,
        hidden: current?.hidden ?? false,
      };
    }));
  }

  async function updateSelectedLayout(
    patch: Partial<Pick<KnowledgeCanvasQueryDto["nodes"][number], "x" | "y" | "pinned" | "hidden">>,
    announcement: string,
    restoreNodeFocus = false,
  ) {
    if (!selectedNode) return;
    const next = { ...selectedNode, ...patch };
    const saved = await persistLayout([{ ...next, x: next.x ?? 0, y: next.y ?? 0 }]);
    if (!saved) return;
    if (next.hidden) {
      setCanvas((current) => ({
        ...current,
        nodes: current.nodes.filter((node) => node.id !== next.id),
        list: current.list.filter((node) => node.id !== next.id),
        hiddenNodes: [...current.hiddenNodes.filter((node) => node.id !== next.id), next],
      }));
      setDraggedNodes((current) => current?.filter((node) => node.id !== next.id) ?? null);
      setLayoutAnnouncement(announcement);
      return;
    }
    setCanvas((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === next.id ? next : node) }));
    setDraggedNodes((current) => current?.map((node) => node.id === next.id ? { ...node, position: { x: next.x ?? 0, y: next.y ?? 0 } } : node) ?? null);
    setLayoutAnnouncement(announcement);
    if (restoreNodeFocus) focusCanvasNode(next.id);
  }

  async function nudgeSelected(dx: number, dy: number) {
    if (!selectedNode) return;
    const direction = dx < 0 ? "向左" : dx > 0 ? "向右" : dy < 0 ? "向上" : "向下";
    await updateSelectedLayout(
      { x: (selectedNode.x ?? 0) + dx, y: (selectedNode.y ?? 0) + dy },
      `${selectedNode.label}${direction}移动 24 像素，布局已保存`,
      true,
    );
  }

  async function autoLayout() {
    const patches = canvas.nodes.map((node, index) => ({
      ...node,
      x: (index % 5) * 210,
      y: Math.floor(index / 5) * 120,
    }));
    const saved = await persistLayout(patches);
    if (!saved) return;
    setCanvas((current) => ({ ...current, nodes: patches }));
    setDraggedNodes(toFlowNodes({ ...canvas, nodes: patches }, desktop));
    setLayoutAnnouncement(`已自动排列 ${patches.length} 个对象，布局已保存`);
    if (selectedNode) focusCanvasNode(selectedNode.id);
  }

  async function moveSelectedToGroup() {
    const target = canvas.nodes.find((node) => node.id === groupTargetId);
    if (!selectedNode || !target) return;
    await updateSelectedLayout(
      { x: (target.x ?? 0) + 190, y: target.y ?? 0 },
      `${selectedNode.label}已移动到${target.label}真实分组，布局已保存`,
      true,
    );
  }

  async function restoreHiddenNode() {
    const target = canvas.hiddenNodes.find((node) => node.id === effectiveHiddenTargetId);
    if (!target) return;
    const saved = await persistLayout([{ ...target, x: target.x ?? 0, y: target.y ?? 0, hidden: false }]);
    if (!saved) return;
    setCanvas((current) => ({
      ...current,
      nodes: [...current.nodes, { ...target, hidden: false }],
      list: [...current.list, { id: target.id, entityType: target.entityType, label: target.label, href: target.href, subjectId: target.subjectId }],
      hiddenNodes: current.hiddenNodes.filter((node) => node.id !== target.id),
    }));
    setDraggedNodes((current) => current ? [...current, ...toFlowNodes({ ...canvas, nodes: [{ ...target, hidden: false }] }, desktop)] : null);
    setSelectedNodeId(target.id);
    setLayoutAnnouncement(`${target.label}已恢复并保存到画布`);
    focusCanvasNode(target.id);
  }

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setDraggedNodes((current) => {
        const base = current ?? toFlowNodes(canvas, desktop);
        const next = applyNodeChanges(changes, base);
        const positionChanged = changes.some((change) => change.type === "position" && change.dragging === false);
        if (positionChanged) {
          void saveLayout(next);
        }
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [desktop, canvas, canvas.layout.revision, canvas.workspaceId],
  );

  async function resetLayout() {
    const response = await fetch("/api/knowledge-canvas/layout", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: canvas.workspaceId,
        expectedRevision: canvas.layout.revision,
      }),
    });
    if (!response.ok) {
      setError("重置布局失败");
      return;
    }
    setResetOpen(false);
    setDraggedNodes(null);
    startTransition(() => {
      void reload({ depth: 1 });
    });
  }

  const listRows = useMemo(() => canvas.list, [canvas.list]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap gap-2">
          <input
            aria-label="搜索画布节点"
            className="min-w-[12rem] flex-1 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm"
            placeholder="搜索节点"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void reload({ depth: canvas.depth });
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
            onClick={() => void reload({ depth: canvas.depth })}
          >
            应用筛选
          </button>
          <button
            type="button"
            className="rounded-md border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
            onClick={() => void reload({ depth: Math.min(4, (canvas.depth || 1) + 1) })}
          >
            展开一层
          </button>
          <button
            type="button"
            className="rounded-md border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
            onClick={() => setView(view === "canvas" ? "list" : "canvas")}
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
              type="button"
              className="rounded-md border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
              onClick={() => setResetOpen(true)}
            >
              重置布局
            </button>
          ) : null}
        </div>
      </div>

      <section className="grid gap-3 rounded-md border border-white/10 bg-[#101419] p-3 lg:grid-cols-[minmax(14rem,1fr)_auto_minmax(14rem,1fr)]" aria-label="画布布局命令">
        <p className="sr-only" role="status" aria-live="polite">{layoutAnnouncement}</p>
        <label className="grid gap-1 text-xs text-zinc-400">
          画布焦点对象
          <select aria-label="画布焦点对象" className="h-10 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100" value={effectiveSelectedNodeId} onChange={(event) => setSelectedNodeId(event.target.value)} disabled={!desktop || layoutPending || canvas.nodes.length === 0}>
            {canvas.nodes.map((node) => <option key={node.id} value={node.id}>{node.label} · {node.entityType}</option>)}
          </select>
        </label>
        <div
          className="grid grid-cols-3 gap-1 self-end justify-self-start rounded-md border border-white/10 p-1 lg:justify-self-center"
          tabIndex={0}
          aria-label="画布布局键盘命令"
          onKeyDown={(event) => {
            const delta = event.key === "ArrowLeft" ? [-24, 0] : event.key === "ArrowRight" ? [24, 0] : event.key === "ArrowUp" ? [0, -24] : event.key === "ArrowDown" ? [0, 24] : null;
            if (!delta || !desktop || layoutPending) return;
            event.preventDefault();
            void nudgeSelected(delta[0], delta[1]);
          }}
        >
          <span />
          <button type="button" aria-label="向上微调" className="grid h-9 w-9 place-items-center rounded border border-white/10" disabled={!desktop || layoutPending || !selectedNode} onClick={() => void nudgeSelected(0, -24)}><ArrowUp size={16} aria-hidden="true" /></button>
          <span />
          <button type="button" aria-label="向左微调" className="grid h-9 w-9 place-items-center rounded border border-white/10" disabled={!desktop || layoutPending || !selectedNode} onClick={() => void nudgeSelected(-24, 0)}><ArrowLeft size={16} aria-hidden="true" /></button>
          <button type="button" aria-label="向下微调" className="grid h-9 w-9 place-items-center rounded border border-white/10" disabled={!desktop || layoutPending || !selectedNode} onClick={() => void nudgeSelected(0, 24)}><ArrowDown size={16} aria-hidden="true" /></button>
          <button type="button" aria-label="向右微调" className="grid h-9 w-9 place-items-center rounded border border-white/10" disabled={!desktop || layoutPending || !selectedNode} onClick={() => void nudgeSelected(24, 0)}><ArrowRight size={16} aria-hidden="true" /></button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          <label className="grid gap-1 text-xs text-zinc-400">
            移动到真实分组
            <select aria-label="移动到真实分组" className="h-10 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100" value={groupTargetId} onChange={(event) => setGroupTargetId(event.target.value)} disabled={!desktop || layoutPending || subjectGroups.length === 0}>
              <option value="">选择分组</option>
              {subjectGroups.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-2 self-end">
            <button type="button" title="自动布局" aria-label="自动布局" className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm" disabled={!desktop || layoutPending || canvas.nodes.length === 0} onClick={() => void autoLayout()}><WandSparkles size={16} aria-hidden="true" />自动布局</button>
            <button type="button" title={selectedNode?.pinned ? "取消固定" : "固定对象"} aria-label={selectedNode?.pinned ? "取消固定" : "固定对象"} className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm" disabled={!desktop || layoutPending || !selectedNode} onClick={() => void updateSelectedLayout({ pinned: !selectedNode?.pinned }, `${selectedNode?.label ?? "对象"}已${selectedNode?.pinned ? "取消固定" : "固定"}并保存`)}>{selectedNode?.pinned ? <PinOff size={16} aria-hidden="true" /> : <Pin size={16} aria-hidden="true" />}{selectedNode?.pinned ? "取消固定" : "固定"}</button>
            <button type="button" title="移动到真实分组" aria-label="移动到真实分组" className="h-10 rounded-md border border-white/10 px-3 text-sm" disabled={!desktop || layoutPending || !selectedNode || !groupTargetId} onClick={() => void moveSelectedToGroup()}>移动</button>
            <button type="button" title="隐藏对象" aria-label="隐藏对象" className="grid h-10 w-10 place-items-center rounded-md border border-white/10" disabled={!desktop || layoutPending || !selectedNode} onClick={() => void updateSelectedLayout({ hidden: true }, `${selectedNode?.label ?? "对象"}已隐藏并保存`)}><EyeOff size={16} aria-hidden="true" /></button>
          </div>
          {canvas.hiddenNodes.length > 0 ? (
            <div className="flex gap-2">
              <select aria-label="恢复隐藏对象" className="h-10 min-w-0 flex-1 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100" value={effectiveHiddenTargetId} onChange={(event) => setHiddenTargetId(event.target.value)} disabled={!desktop || layoutPending}>
                {canvas.hiddenNodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
              </select>
              <button type="button" title="恢复隐藏对象" aria-label="恢复隐藏对象" className="grid h-10 w-10 place-items-center rounded-md border border-white/10" disabled={!desktop || layoutPending || !effectiveHiddenTargetId} onClick={() => void restoreHiddenNode()}><Eye size={16} aria-hidden="true" /></button>
            </div>
          ) : null}
        </div>
      </section>

      {!desktop ? (
        <p className="text-xs text-zinc-500" role="status">
          移动端可搜索、平移、缩放与打开详情；布局编辑仅桌面可用。
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-amber-300" role="alert">
          {error}
        </p>
      ) : null}
      {pending ? <p className="text-xs text-zinc-500">刷新中…</p> : null}

      {view === "list" ? (
        <ul className="divide-y divide-white/10 rounded-md border border-white/10" aria-label="画布等价列表">
          {listRows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div>
                <p className="text-zinc-100">{row.label}</p>
                <p className="text-xs text-zinc-500">{row.entityType}</p>
              </div>
              {row.href ? (
                <Link className="text-teal-300 hover:underline" href={row.href}>
                  打开
                </Link>
              ) : null}
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
            onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
            fitView
            proOptions={{ hideAttribution: true }}
            aria-label="知识关联画布"
          >
            <Background gap={18} size={1} color="rgba(255,255,255,0.06)" />
            <Controls />
            {canMutateKnowledgeCanvasLayout({ isDesktopViewport: desktop }) ? <MiniMap pannable zoomable /> : null}
          </ReactFlow>
        </div>
      )}

      {canvas.truncated ? (
        <button
          type="button"
          className="text-sm text-teal-300 hover:underline"
          onClick={() => void reload({ cursor: canvas.nextCursor, depth: canvas.depth })}
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
          <Link className="block rounded-md border border-white/10 px-3 py-2 hover:bg-white/5" href="/today/plan">
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
          <button type="button" className="rounded-md bg-amber-500/20 px-3 py-2 text-sm text-amber-100" onClick={() => void resetLayout()}>
            确认重置
          </button>
        </div>
      </Modal>
    </div>
  );
}
