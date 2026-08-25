import { ListDetailLink } from "@/components/list-return-context";
import type {
  KnowledgeCanvasReload,
  LayoutConflictState,
} from "@/components/knowledge-canvas-layout-controller";
import { Button, IconButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Drawer, Modal } from "@/components/ui/overlays";
import { formatDateTime } from "@/lib/formatters";
import type { KnowledgeCanvasQueryDto } from "@/lib/contracts";
import {
  canvasRelationKindLabels,
  knowledgeCanvasRelationLabelsByNode,
  projectVisibleKnowledgeCanvas,
  type CanvasRelationKind,
} from "@/lib/knowledge/canvas-projection";
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
import Link from "next/link";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type Viewport,
} from "@xyflow/react";
import { canMutateKnowledgeCanvasLayout, KNOWLEDGE_CANVAS_ENTITY_TYPES } from "@areaforge/core";
import { useMemo, type RefObject } from "react";
import "@xyflow/react/dist/style.css";

type VisibleCanvas = ReturnType<typeof projectVisibleKnowledgeCanvas>;
type CanvasNode = KnowledgeCanvasQueryDto["nodes"][number];

interface KnowledgeCanvasViewState {
  canvas: KnowledgeCanvasQueryDto;
  visibleCanvas: VisibleCanvas;
  nodes: Node[];
  edges: Edge[];
  query: string;
  entityTypeFilter: string;
  subjectFilter: string;
  relationKindFilter: CanvasRelationKind | "";
  statusFilter: "active" | "all";
  view: "canvas" | "list";
  desktop: boolean;
  effectiveSelectedNodeId: string;
  effectiveHiddenTargetId: string;
  selectedNode: CanvasNode | null;
  selectedNodeCollapsed: boolean;
  groupTargetId: string;
  offline: boolean;
  error: string | null;
  layoutDirty: boolean;
  layoutPending: boolean;
  layoutAnnouncement: string;
  layoutConflict: LayoutConflictState | null;
  nodeLimitReached: boolean;
  pending: boolean;
  loading: boolean;
  createOpen: boolean;
  resetOpen: boolean;
  viewport: Viewport;
}

interface KnowledgeCanvasViewActions {
  setQuery: (value: string) => void;
  setEntityTypeFilter: (value: string) => void;
  setSubjectFilter: (value: string) => void;
  setRelationKindFilter: (value: CanvasRelationKind | "") => void;
  setStatusFilter: (value: "active" | "all") => void;
  reload: KnowledgeCanvasReload;
  toggleEquivalentView: () => void;
  setCreateOpen: (open: boolean) => void;
  setResetOpen: (open: boolean) => void;
  setSelectedNodeId: (id: string) => void;
  nudgeSelected: (dx: number, dy: number) => void;
  setGroupTargetId: (id: string) => void;
  autoLayout: () => void;
  toggleSelectedPinned: () => void;
  moveSelectedToGroup: () => void;
  hideSelectedNode: () => void;
  setHiddenTargetId: (id: string) => void;
  restoreHiddenNode: () => void;
  focusBranch: (id: string) => void;
  toggleSelectedCollapsed: () => void;
  retryLayoutQueue: () => void;
  retryLastReload: () => void;
  onNodesChange: (changes: NodeChange[]) => void;
  setViewport: (viewport: Viewport) => void;
  enqueueViewport: (viewport: Viewport) => void;
  resetLayout: () => void;
  adoptLatestLayoutConflict: () => void;
  retryLayoutConflict: () => void;
}

export function KnowledgeCanvasView({
  state,
  actions,
  rootRef,
  hiddenRestoreSelectRef,
  resetLayoutTriggerRef,
  layoutConflictReturnFocusRef,
}: {
  state: KnowledgeCanvasViewState;
  actions: KnowledgeCanvasViewActions;
  rootRef: RefObject<HTMLDivElement | null>;
  hiddenRestoreSelectRef: RefObject<HTMLSelectElement | null>;
  resetLayoutTriggerRef: RefObject<HTMLButtonElement | null>;
  layoutConflictReturnFocusRef: RefObject<HTMLElement | null>;
}) {
  const { canvas, visibleCanvas, selectedNode } = state;
  const subjects = canvas.filterOptions.subjects;
  const subjectGroups = canvas.nodes.filter((node) => node.entityType === "SUBJECT_GROUP");
  const relationLabelsByNode = useMemo(
    () => knowledgeCanvasRelationLabelsByNode(visibleCanvas.edges),
    [visibleCanvas.edges],
  );
  const lastSyncedLabel = useMemo(() => formatDateTime(canvas.syncedAt), [canvas.syncedAt]);

  return (
    <div ref={rootRef} className="min-w-0 space-y-4">
      <h1 className="text-2xl font-semibold text-white">关联画布</h1>
      <div className="af-toolbar-split flex min-w-0 gap-3">
        <div className="flex flex-1 flex-wrap gap-2">
          <Input
            aria-label="搜索画布节点"
            className="min-w-0 basis-full flex-1 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm sm:basis-auto sm:min-w-[12rem]"
            placeholder="搜索节点"
            value={state.query}
            onChange={(event) => actions.setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void actions.reload({ focus: canvas.focusId, depth: canvas.depth });
            }}
          />
          <Select
            aria-label="按类型筛选"
            className="h-10 rounded-md border border-white/10 bg-black/30 px-2 text-sm"
            value={state.entityTypeFilter}
            onChange={(event) => actions.setEntityTypeFilter(event.target.value)}
          >
            <option value="">全部类型</option>
            {KNOWLEDGE_CANVAS_ENTITY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </Select>
          <Select
            aria-label="按科目筛选"
            className="h-10 rounded-md border border-white/10 bg-black/30 px-2 text-sm"
            value={state.subjectFilter}
            onChange={(event) => actions.setSubjectFilter(event.target.value)}
          >
            <option value="">全部科目</option>
            {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.label}</option>)}
          </Select>
          <Select
            aria-label="按关系筛选"
            className="h-10 rounded-md border border-white/10 bg-black/30 px-2 text-sm"
            value={state.relationKindFilter}
            onChange={(event) => actions.setRelationKindFilter(event.target.value as CanvasRelationKind | "")}
          >
            <option value="">全部关系</option>
            {(Object.keys(canvasRelationKindLabels) as CanvasRelationKind[]).map((kind) => (
              <option key={kind} value={kind}>{canvasRelationKindLabels[kind]}</option>
            ))}
          </Select>
          <Select
            aria-label="按状态筛选"
            className="h-10 rounded-md border border-white/10 bg-black/30 px-2 text-sm"
            value={state.statusFilter}
            onChange={(event) => actions.setStatusFilter(event.target.value as "active" | "all")}
          >
            <option value="active">进行中</option>
            <option value="all">全部状态</option>
          </Select>
          <Button type="button" className="h-10 rounded-md border border-white/10 px-3 text-sm hover:bg-white/5" onClick={() => void actions.reload({ focus: canvas.focusId, depth: canvas.depth })}>
            应用筛选
          </Button>
          <Button type="button" className="rounded-md border border-white/10 px-3 py-2 text-sm hover:bg-white/5" onClick={() => void actions.reload({ focus: canvas.focusId, depth: Math.min(4, (canvas.depth || 1) + 1) })}>
            展开一层
          </Button>
          <Button type="button" className="rounded-md border border-white/10 px-3 py-2 text-sm hover:bg-white/5" onClick={actions.toggleEquivalentView}>
            {state.view === "canvas" ? "等价列表" : "画布视图"}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="rounded-md bg-teal-500/20 px-3 py-2 text-sm text-teal-100 hover:bg-teal-500/30" onClick={() => actions.setCreateOpen(true)}>
            快捷创建
          </Button>
          {canMutateKnowledgeCanvasLayout({ isDesktopViewport: state.desktop }) ? (
            <Button ref={resetLayoutTriggerRef} type="button" className="rounded-md border border-white/10 px-3 py-2 text-sm hover:bg-white/5" disabled={state.layoutDirty || state.layoutPending} onClick={() => actions.setResetOpen(true)}>
              重置布局
            </Button>
          ) : null}
        </div>
      </div>

      <section className="af-canvas-command-grid grid min-w-0 gap-3 rounded-md border border-white/10 bg-[#101419] p-3" aria-label="画布布局命令">
        <p className="sr-only" role="status" aria-live="polite">{state.layoutAnnouncement}</p>
        <label className="grid min-w-0 gap-1 text-xs text-zinc-400">
          画布焦点对象
          <Select aria-label="画布焦点对象" className="h-10 w-full min-w-0 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100" value={state.effectiveSelectedNodeId} onChange={(event) => actions.setSelectedNodeId(event.target.value)} disabled={state.layoutPending || visibleCanvas.nodes.length === 0}>
            {visibleCanvas.nodes.map((node) => <option key={node.id} value={node.id}>{node.label} · {node.entityType}</option>)}
          </Select>
        </label>
        <div
          className="grid grid-cols-3 gap-1 self-end justify-self-start rounded-md border border-white/10 p-1"
          tabIndex={0}
          aria-label="画布布局键盘命令"
          onKeyDown={(event) => {
            const delta = event.key === "ArrowLeft" ? [-24, 0] : event.key === "ArrowRight" ? [24, 0] : event.key === "ArrowUp" ? [0, -24] : event.key === "ArrowDown" ? [0, 24] : null;
            if (!delta || !state.desktop) return;
            event.preventDefault();
            actions.nudgeSelected(delta[0], delta[1]);
          }}
        >
          <span />
          <IconButton label="向上微调" type="button" title="向上微调" aria-label="向上微调" className="grid h-9 w-9 place-items-center rounded border border-white/10" disabled={!state.desktop || !selectedNode} onClick={() => actions.nudgeSelected(0, -24)}><ArrowUp size={16} aria-hidden="true" /></IconButton>
          <span />
          <IconButton label="向左微调" type="button" title="向左微调" aria-label="向左微调" className="grid h-9 w-9 place-items-center rounded border border-white/10" disabled={!state.desktop || !selectedNode} onClick={() => actions.nudgeSelected(-24, 0)}><ArrowLeft size={16} aria-hidden="true" /></IconButton>
          <IconButton label="向下微调" type="button" title="向下微调" aria-label="向下微调" className="grid h-9 w-9 place-items-center rounded border border-white/10" disabled={!state.desktop || !selectedNode} onClick={() => actions.nudgeSelected(0, 24)}><ArrowDown size={16} aria-hidden="true" /></IconButton>
          <IconButton label="向右微调" type="button" title="向右微调" aria-label="向右微调" className="grid h-9 w-9 place-items-center rounded border border-white/10" disabled={!state.desktop || !selectedNode} onClick={() => actions.nudgeSelected(24, 0)}><ArrowRight size={16} aria-hidden="true" /></IconButton>
        </div>
        <div className="af-canvas-secondary-grid grid min-w-0 gap-2">
          <label className="grid min-w-0 gap-1 text-xs text-zinc-400">
            移动到真实分组
            <Select aria-label="移动到真实分组" className="h-10 w-full min-w-0 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100" value={state.groupTargetId} onChange={(event) => actions.setGroupTargetId(event.target.value)} disabled={!state.desktop || subjectGroups.length === 0}>
              <option value="">选择分组</option>
              {subjectGroups.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
            </Select>
          </label>
          <div className="flex flex-wrap gap-2 self-end">
            <Button type="button" title="自动布局" aria-label="自动布局" className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm" disabled={!state.desktop || canvas.nodes.length === 0} onClick={actions.autoLayout}><WandSparkles size={16} aria-hidden="true" />自动布局</Button>
            <Button type="button" title={selectedNode?.pinned ? "取消固定" : "固定对象"} aria-label={selectedNode?.pinned ? "取消固定" : "固定对象"} className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm" disabled={!state.desktop || !selectedNode} onClick={actions.toggleSelectedPinned}>{selectedNode?.pinned ? <PinOff size={16} aria-hidden="true" /> : <Pin size={16} aria-hidden="true" />}{selectedNode?.pinned ? "取消固定" : "固定"}</Button>
            <Button type="button" title="移动到真实分组" aria-label="移动到真实分组" className="h-10 rounded-md border border-white/10 px-3 text-sm" disabled={!state.desktop || !selectedNode || !state.groupTargetId} onClick={actions.moveSelectedToGroup}>移动</Button>
            <IconButton label="隐藏对象" type="button" title="隐藏对象" aria-label="隐藏对象" className="grid h-10 w-10 place-items-center rounded-md border border-white/10" disabled={!state.desktop || !selectedNode} onClick={actions.hideSelectedNode}><EyeOff size={16} aria-hidden="true" /></IconButton>
          </div>
          {canvas.hiddenNodes.length > 0 ? (
            <div className="flex gap-2">
              <Select ref={hiddenRestoreSelectRef} aria-label="恢复隐藏对象" className="h-10 min-w-0 flex-1 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm text-zinc-100" value={state.effectiveHiddenTargetId} onChange={(event) => actions.setHiddenTargetId(event.target.value)} disabled={!state.desktop}>
                {canvas.hiddenNodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
              </Select>
              <IconButton label="恢复隐藏对象" type="button" title="恢复隐藏对象" aria-label="恢复隐藏对象" className="grid h-10 w-10 place-items-center rounded-md border border-white/10" disabled={!state.desktop || !state.effectiveHiddenTargetId} onClick={actions.restoreHiddenNode}><Eye size={16} aria-hidden="true" /></IconButton>
            </div>
          ) : null}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2" aria-label="当前对象操作">
        <Button type="button" className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm hover:bg-white/5" disabled={!selectedNode || state.loading} onClick={() => selectedNode && actions.focusBranch(selectedNode.id)}>
          <Focus size={16} aria-hidden="true" />聚焦分支
        </Button>
        <Button type="button" className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm hover:bg-white/5" disabled={!selectedNode || state.loading} onClick={actions.toggleSelectedCollapsed}>
          {state.selectedNodeCollapsed ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
          {state.selectedNodeCollapsed ? "展开" : "折叠"}
        </Button>
        {selectedNode?.href ? (
          <Link className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500/20 px-3 text-sm text-teal-100 hover:bg-teal-500/30" href={selectedNode.href}>
            <ExternalLink size={16} aria-hidden="true" />打开当前对象
          </Link>
        ) : null}
        <span className="text-xs text-zinc-500">当前聚焦：{canvas.nodes.find((node) => node.id === canvas.focusId)?.label ?? "考试工作区"}</span>
      </div>

      {!state.desktop ? <p className="text-xs text-zinc-500" role="status">移动端可搜索、平移、缩放与打开详情；布局编辑仅桌面可用。</p> : null}
      {state.offline || state.error ? (
        <div className="flex items-center gap-3 border-l-2 border-amber-400 bg-amber-400/5 px-3 py-2 text-sm text-amber-200" role={state.error ? "alert" : "status"}>
          {state.offline ? <WifiOff size={16} aria-hidden="true" /> : null}
          <div className="min-w-0 flex-1">
            <p>{state.error ?? "当前离线"} · 上次同步于 {lastSyncedLabel}</p>
            {state.layoutDirty ? <p className="mt-1 text-xs">本地布局 patch 已保留，重试不会重新加载画布。</p> : null}
            {state.layoutConflict ? <p className="mt-1 text-xs">服务端 revision {state.layoutConflict.latest?.revision ?? "未知"}；冲突字段：{state.layoutConflict.conflictFields.join("、")}。</p> : null}
          </div>
          <IconButton label={state.layoutDirty ? "重试保存本地布局" : "重试画布请求"} type="button" title={state.layoutDirty ? "重试保存本地布局" : "重试画布请求"} aria-label={state.layoutDirty ? "重试保存本地布局" : "重试画布请求"} className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-amber-300/30" disabled={state.loading || state.layoutPending} onClick={() => state.layoutDirty ? actions.retryLayoutQueue() : actions.retryLastReload()}>
            <RefreshCw size={16} aria-hidden="true" />
          </IconButton>
        </div>
      ) : (
        <p className="text-xs text-zinc-500" role="status">{state.layoutDirty ? (state.layoutPending ? "布局修改正在同步" : "布局修改等待重试") : `上次同步于 ${lastSyncedLabel}`}</p>
      )}
      {state.nodeLimitReached ? <p className="text-sm text-amber-300" role="status">当前视图已达到 500 个对象上限，请聚焦分支或缩小筛选范围。</p> : null}
      {canvas.pageContextTruncated ? <p className="text-sm text-amber-300" role="status">当前对象的关系上下文超过单页容量；请聚焦该对象继续查看。</p> : null}
      {state.pending || state.loading ? <p className="text-xs text-zinc-500">刷新中…</p> : null}

      {state.view === "list" ? (
        <ul className="divide-y divide-white/10 rounded-md border border-white/10" aria-label="画布等价列表">
          {visibleCanvas.list.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="text-zinc-100">{row.label}</p>
                <p className="text-xs text-zinc-500">{row.entityType}{relationLabelsByNode.get(row.id)?.size ? ` · ${[...relationLabelsByNode.get(row.id)!].join("、")}` : ""}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button type="button" className="text-zinc-300 hover:text-white" onClick={() => actions.focusBranch(row.id)}>聚焦</Button>
                {row.href ? <ListDetailLink className="text-teal-300 hover:underline" href={row.href} focusId={`canvas-row-${row.id}`}>打开</ListDetailLink> : null}
              </div>
            </li>
          ))}
          {visibleCanvas.list.length === 0 ? <li className="px-3 py-6 text-sm text-zinc-500">当前筛选无节点。</li> : null}
        </ul>
      ) : (
        <div className="h-[clamp(28rem,60dvh,40rem)] overflow-hidden rounded-md border border-white/10 bg-[#0b1017]">
          <ReactFlow
            nodes={state.nodes}
            edges={state.edges}
            onNodesChange={canMutateKnowledgeCanvasLayout({ isDesktopViewport: state.desktop }) ? actions.onNodesChange : undefined}
            nodesDraggable={canMutateKnowledgeCanvasLayout({ isDesktopViewport: state.desktop })}
            viewport={state.viewport}
            onViewportChange={actions.setViewport}
            onMoveEnd={(event, nextViewport) => {
              if (event) actions.enqueueViewport(nextViewport);
            }}
            onNodeClick={(_event, node) => actions.setSelectedNodeId(node.id)}
            onNodeDoubleClick={(_event, node) => actions.focusBranch(node.id)}
            fitView={!canvas.layout.hasSavedLayout}
            proOptions={{ hideAttribution: true }}
            aria-label="知识关联画布"
          >
            <Background gap={18} size={1} color="rgba(255,255,255,0.06)" />
            <Controls />
            {canMutateKnowledgeCanvasLayout({ isDesktopViewport: state.desktop }) ? <MiniMap pannable zoomable /> : null}
          </ReactFlow>
        </div>
      )}

      {canvas.truncated && canvas.nextCursor && !state.nodeLimitReached ? (
        <Button type="button" className="text-sm text-teal-300 hover:underline" onClick={() => void actions.reload({ focus: canvas.focusId, cursor: canvas.nextCursor, depth: canvas.depth })}>
          继续加载下一页
        </Button>
      ) : null}

      <Drawer open={state.createOpen} onClose={() => actions.setCreateOpen(false)} title="快捷创建">
        <div className="space-y-3 text-sm">
          <p className="text-zinc-400">创建后进入对应工作台表单；对象写入真实表，画布重新派生。</p>
          <Link className="block rounded-md border border-white/10 px-3 py-2 hover:bg-white/5" href="/knowledge/cards">创建知识卡片</Link>
          <Link className="block rounded-md border border-white/10 px-3 py-2 hover:bg-white/5" href="/knowledge/mistakes">创建错题</Link>
          <Link className="block rounded-md border border-white/10 px-3 py-2 hover:bg-white/5" href="/knowledge/resources">创建资料</Link>
          <Link className="block rounded-md border border-white/10 px-3 py-2 hover:bg-white/5" href="/roadmap/allocation">创建任务</Link>
        </div>
      </Drawer>

      <Modal open={state.resetOpen} onClose={() => actions.setResetOpen(false)} title="重置个人布局？">
        <p className="text-sm text-zinc-400">只清除视口与节点位置偏好，不会删除业务对象或关系。</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" className="rounded-md border border-white/10 px-3 py-2 text-sm" onClick={() => actions.setResetOpen(false)}>取消</Button>
          <Button type="button" className="rounded-md bg-amber-500/20 px-3 py-2 text-sm text-amber-100" disabled={state.layoutDirty || state.layoutPending} onClick={actions.resetLayout}>确认重置</Button>
        </div>
      </Modal>

      <Modal open={state.layoutConflict !== null} title="布局已在其他设备更新" allowEscape={false} returnFocusRef={layoutConflictReturnFocusRef}>
        <div className="space-y-3 text-sm text-zinc-300">
          <p>服务端 revision {state.layoutConflict?.latest?.revision ?? "未知"}；冲突字段：{state.layoutConflict?.conflictFields.join("、") ?? "revision"}。本地修改仍保留，系统不会强制覆盖。</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" className="rounded-md border border-white/10 px-3 py-2 text-sm" onClick={actions.adoptLatestLayoutConflict}>采用服务端布局</Button>
            <Button type="button" className="rounded-md bg-teal-500/20 px-3 py-2 text-sm text-teal-100" onClick={actions.retryLayoutConflict}>
              {state.layoutConflict?.action === "reset" ? "使用最新状态重试重置" : "保留本地修改并重试"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
