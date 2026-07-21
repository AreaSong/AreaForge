"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
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
import { canMutateKnowledgeCanvasLayout } from "@areaforge/core";
import type { KnowledgeCanvasQueryDto } from "@/lib/study/knowledge-canvas-service";
import { Drawer, Modal } from "@/components/ui/overlays";

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

export function KnowledgeCanvasClient(props: { initial: KnowledgeCanvasQueryDto }) {
  const desktop = useIsDesktop();
  const [canvas, setCanvas] = useState(props.initial);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"canvas" | "list">("canvas");
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [draggedNodes, setDraggedNodes] = useState<Node[] | null>(null);

  const nodes = useMemo(
    () => draggedNodes ?? toFlowNodes(canvas, desktop),
    [canvas, desktop, draggedNodes],
  );
  const edges = useMemo(() => toFlowEdges(canvas), [canvas]);

  async function reload(params?: { focus?: string; cursor?: string | null; depth?: number }) {
    setError(null);
    const search = new URLSearchParams();
    search.set("workspaceId", canvas.workspaceId);
    search.set("depth", String(params?.depth ?? canvas.depth ?? 1));
    if (params?.focus) search.set("focus", params.focus);
    if (params?.cursor) search.set("cursor", params.cursor);
    if (query.trim()) search.set("q", query.trim());
    const response = await fetch(`/api/knowledge-canvas?${search.toString()}`);
    if (!response.ok) {
      setError("画布加载失败");
      return;
    }
    const body = (await response.json()) as { canvas: KnowledgeCanvasQueryDto };
    setDraggedNodes(null);
    setCanvas(body.canvas);
  }

  async function saveLayout(nextNodes: Node[]) {
    if (!canMutateKnowledgeCanvasLayout({ isDesktopViewport: desktop })) return;
    const response = await fetch("/api/knowledge-canvas/layout", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: canvas.workspaceId,
        expectedRevision: canvas.layout.revision,
        viewportX: canvas.layout.viewportX,
        viewportY: canvas.layout.viewportY,
        viewportZoom: canvas.layout.viewportZoom,
        nodes: nextNodes.map((node) => {
          const [entityType, entityId] = node.id.split(":");
          return {
            entityType,
            entityId,
            x: node.position.x,
            y: node.position.y,
          };
        }),
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
