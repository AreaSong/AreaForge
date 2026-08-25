import Link from "next/link";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { DetailHeading } from "@/components/detail-heading";
import { PlanInboxOriginSummary, planInboxOriginLabel } from "@/components/plan-inbox-origin";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/field";
import type { PlanInboxFormOptions, PlanInboxItemDto } from "@/lib/contracts";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import {
  buildPlanInboxConflictComparisons,
  detailHref,
  planInboxStatusLabel,
  shanghaiDateOffset,
  type DependencyType,
  type PendingPlanInboxConvert,
  type PlanInboxConflict,
  type PlanInboxFormDraft,
} from "@/components/plan-inbox-item-utils";

interface CreatedMilestone {
  id: string;
  subjectId: string | null;
  title: string;
}

export function PlanInboxItemView(props: {
  item: PlanInboxItemDto;
  options: PlanInboxFormOptions;
  returnTo: string;
  createdMilestone: CreatedMilestone | null;
  draft: PlanInboxFormDraft;
  baseRevision: number;
  dirty: boolean;
  pendingConvert: PendingPlanInboxConvert | null;
  error: string | null;
  conflict: PlanInboxConflict | null;
  conflictOpen: boolean;
  busy: boolean;
  onDraftChange: (patch: Partial<PlanInboxFormDraft>) => void;
  onToggleRelated: (nodeId: string) => void;
  onTogglePredecessor: (taskId: string) => void;
  onDependencyTypeChange: (taskId: string, dependencyType: DependencyType) => void;
  onRetryUnknownConvert: () => void;
  onSave: () => void;
  onConvert: () => void;
  onTransition: (action: "dismiss" | "reopen") => void;
  onCreateRequiredMilestone: () => void;
  onConflictOpen: () => void;
  onConflictClose: () => void;
  onApplyServerVersion: (latest: PlanInboxItemDto) => void;
  onAdoptLatestRevision: (latest: PlanInboxItemDto) => void;
}) {
  const { draft, item } = props;
  const nodes = props.options.nodes.filter((node) => node.subjectId === draft.subjectId);
  const milestones = [...props.options.milestones, ...(props.createdMilestone ? [props.createdMilestone] : [])]
    .filter((milestone) => !milestone.subjectId || milestone.subjectId === draft.subjectId);
  const tasks = props.options.tasks;
  const localMissing = [
    !draft.title.trim() ? "标题" : null,
    !draft.subjectId ? "科目" : null,
    !draft.plannedDate ? "日期" : null,
    !Number(draft.estimatedMinutes) || Number(draft.estimatedMinutes) < 1 ? "预计时长" : null,
    item.requiredMilestoneKey && !draft.planMilestoneId ? "里程碑" : null,
  ].filter((value): value is string => Boolean(value));
  const readOnly = item.status === "CONVERTED" || Boolean(item.supersededByItemId) || Boolean(props.pendingConvert);

  return (
    <section className="space-y-5">
      <Link href={props.returnTo} className="text-sm text-zinc-400 hover:text-zinc-200">返回收件箱</Link>
      <header>
        <p className="text-sm text-teal-300">{planInboxOriginLabel(item.originType)}</p>
        <DetailHeading className="mt-1 text-3xl font-semibold text-white">
          {item.originType === "DAILY_REVIEW_MINIMUM" ? "补全明日任务" : "计划草稿"}
        </DetailHeading>
        <p className="mt-2 text-sm text-zinc-500">
          {planInboxStatusLabel(item.status)} · 版本 {item.revision}{props.dirty ? " · 有未保存修改" : ""}
        </p>
      </header>
      {item.supersededByItemId ? (
        <p className="rounded-md border border-amber-300/20 bg-amber-400/5 p-3 text-sm text-amber-200">
          已被新版本取代。
          <Link
            href={withReturnTo(`/roadmap/allocation/drafts/${item.supersededByItemId}`, detailHref(item.id, props.returnTo))}
            className="ml-2 text-teal-300 hover:underline"
          >
            查看最新
          </Link>
        </p>
      ) : null}
      {props.pendingConvert ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300/20 bg-amber-400/5 p-3 text-sm text-amber-100">
          <span>上次转换结果未知；草稿、revision 与命令身份均已保留，不会自动重放。</span>
          <Button type="button" disabled={props.busy} className="h-10 border-amber-200/30 px-3" onClick={props.onRetryUnknownConvert}>
            {props.busy ? "确认中..." : "确认上次转换结果"}
          </Button>
        </div>
      ) : null}

      <PlanInboxOriginSummary item={item} returnTo={detailHref(item.id, props.returnTo)} />
      <details className="border-y border-white/10 py-3">
        <summary className="cursor-pointer text-sm text-zinc-400">高级来源信息</summary>
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-zinc-500">{JSON.stringify(item.originSnapshot, null, 2)}</pre>
      </details>

      <div className="space-y-4 rounded-md border border-white/10 bg-[#101419] p-4">
        <div className="af-content-grid-two grid gap-4">
          <label className="block text-sm sm:col-span-2">
            标题
            <Input disabled={readOnly} className="mt-1 px-2" value={draft.title} onChange={(event) => props.onDraftChange({ title: event.target.value })} />
          </label>
          <label className="block text-sm">
            科目
            <Select
              disabled={readOnly}
              className="mt-1 px-2"
              value={draft.subjectId}
              onChange={(event) => props.onDraftChange({ subjectId: event.target.value, primaryNodeId: "", relatedNodeIds: [] })}
            >
              <option value="">请选择</option>
              {props.options.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </Select>
          </label>
          <div className="text-sm">
            <label className="block">
              计划日期
              <Input disabled={readOnly} type="date" className="mt-1 px-2" value={draft.plannedDate} onChange={(event) => props.onDraftChange({ plannedDate: event.target.value })} />
            </label>
            {!readOnly ? (
              <div className="mt-2 flex gap-2" aria-label="快捷安排日期">
                <Button type="button" variant="ghost" size="sm" className="text-teal-300" onClick={() => props.onDraftChange({ plannedDate: shanghaiDateOffset(0) })}>今天</Button>
                <Button type="button" variant="ghost" size="sm" className="text-teal-300" onClick={() => props.onDraftChange({ plannedDate: shanghaiDateOffset(1) })}>明天</Button>
              </div>
            ) : null}
          </div>
          <label className="block text-sm">预计时长（分钟）<Input disabled={readOnly} type="number" min="1" max="1440" className="mt-1 px-2" value={draft.estimatedMinutes} onChange={(event) => props.onDraftChange({ estimatedMinutes: event.target.value })} /></label>
          <label className="block text-sm">优先级<Select disabled={readOnly} className="mt-1 px-2" value={draft.priority} onChange={(event) => props.onDraftChange({ priority: event.target.value })}><option value="LOW">低</option><option value="MEDIUM">中</option><option value="HIGH">高</option><option value="CRITICAL">关键</option></Select></label>
          <label className="block text-sm">类型<Input disabled={readOnly} className="mt-1 px-2" value={draft.type} onChange={(event) => props.onDraftChange({ type: event.target.value })} /></label>
          <label className="block text-sm">里程碑<Select disabled={readOnly} className="mt-1 px-2" value={draft.planMilestoneId} onChange={(event) => props.onDraftChange({ planMilestoneId: event.target.value })}><option value="">不关联</option>{milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}</Select></label>
          <label className="block text-sm sm:col-span-2">主考纲节点<Select disabled={readOnly} className="mt-1 px-2" value={draft.primaryNodeId} onChange={(event) => props.onDraftChange({ primaryNodeId: event.target.value })}><option value="">不关联</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</Select></label>
        </div>
        <fieldset className="min-w-0" disabled={readOnly}>
          <legend className="text-sm font-medium text-white">相关考纲节点</legend>
          <div className="af-content-grid-two mt-2 grid gap-2">
            {nodes.filter((node) => node.id !== draft.primaryNodeId).map((node) => (
              <label key={node.id} className="flex min-w-0 items-center gap-2 text-sm text-zinc-300">
                <Checkbox checked={draft.relatedNodeIds.includes(node.id)} onChange={() => props.onToggleRelated(node.id)} />
                <span className="min-w-0 flex-1 truncate">{node.title}</span>
              </label>
            ))}
            {nodes.length === 0 ? <p className="text-sm text-zinc-500">选择科目后显示节点。</p> : null}
          </div>
        </fieldset>
        <fieldset className="min-w-0" disabled={readOnly}>
          <legend className="text-sm font-medium text-white">现有任务前置依赖</legend>
          <div className="mt-2 space-y-2">
            {tasks.map((task) => {
              const entry = draft.predecessors.find((value) => value.taskId === task.id);
              return (
                <div key={task.id} className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <Checkbox checked={Boolean(entry)} onChange={() => props.onTogglePredecessor(task.id)} />
                    <span className="min-w-0 flex-1 truncate">{task.subjectName} · {task.title}</span>
                  </label>
                  {entry ? (
                    <Select
                      aria-label={`${task.title} 依赖类型`}
                      className="h-9 px-2"
                      value={entry.dependencyType}
                      onChange={(event) => props.onDependencyTypeChange(task.id, event.target.value as DependencyType)}
                    >
                      <option value="SOFT">软依赖</option>
                      <option value="HARD">硬依赖（阻止开始）</option>
                    </Select>
                  ) : null}
                </div>
              );
            })}
            {tasks.length === 0 ? <p className="text-sm text-zinc-500">当前工作区没有可用前置任务。</p> : null}
          </div>
        </fieldset>
        {item.dependencyRefs.filter((ref) => ref.targetType === "INBOX_STABLE_REF").map((ref) => (
          <p key={ref.id} className="text-sm text-amber-200">
            前置计划 <Link className="text-teal-300 hover:underline" href={withReturnTo(`/roadmap/allocation/drafts?stableRef=${encodeURIComponent(`${ref.planStableKey ?? ""}@${ref.planOriginVersion ?? ""}`)}`, detailHref(item.id, props.returnTo))}>{ref.planStableKey}@{ref.planOriginVersion ?? "?"}</Link> 必须先转换（{ref.dependencyType}）。
          </p>
        ))}
      </div>

      <section className="rounded-md border border-white/10 bg-[#101419] p-4">
        <h2 className="font-medium text-white">转换预览</h2>
        <p className="mt-2 text-sm text-zinc-400">将创建 1 个正式任务、{draft.relatedNodeIds.length} 个相关节点关系、{draft.predecessors.length + item.dependencyRefs.filter((ref) => ref.targetType === "INBOX_STABLE_REF").length} 条前置依赖。</p>
        {localMissing.length ? <p className="mt-2 text-sm text-amber-200">尚缺：{localMissing.join("、")}</p> : <p className="mt-2 text-sm text-emerald-300">必填字段完整。</p>}
      </section>

      <div className="flex flex-wrap gap-2">
        {item.status === "OPEN" && !readOnly ? (
          <>
            <Button type="button" disabled={props.busy || !props.dirty} className="h-11 px-4" onClick={props.onSave}>{props.busy ? "处理中..." : "保存草稿"}</Button>
            <Button type="button" variant="primary" disabled={props.busy || localMissing.length > 0} className="h-11 px-4" onClick={props.onConvert}>{props.busy ? "保存并转换中..." : "转换为任务"}</Button>
            <Button type="button" disabled={props.busy} className="h-11 px-4 text-zinc-300" onClick={() => props.onTransition("dismiss")}>忽略</Button>
          </>
        ) : null}
        {item.status === "DISMISSED" && !item.supersededByItemId ? <Button type="button" disabled={props.busy || Boolean(props.pendingConvert)} className="h-11 px-4 text-teal-300" onClick={() => props.onTransition("reopen")}>恢复 / Undo</Button> : null}
        {item.convertedTaskId ? <Link href={withReturnTo(`/roadmap/allocation/tasks/${item.convertedTaskId}`, props.returnTo)} className="h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium leading-[44px] text-black">打开任务</Link> : null}
      </div>
      {props.error ? <p role="alert" className="text-sm text-red-300">{props.error}</p> : null}
      {item.requiredMilestoneKey && !item.planMilestoneId ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-amber-200">
          <span>此草稿引用 canonical 里程碑 {item.requiredMilestoneKey}。</span>
          <Button type="button" variant="ghost" size="sm" className="text-teal-300 underline" disabled={props.busy || Boolean(props.pendingConvert) || !props.options.stagePlans.length} onClick={props.onCreateRequiredMilestone}>创建并选中</Button>
          {!props.options.stagePlans.length ? <Link className="text-teal-300 hover:underline" href={withReturnTo("/roadmap/stages", detailHref(item.id, props.returnTo))}>先创建阶段计划</Link> : null}
        </div>
      ) : null}
      {props.conflict ? <Button type="button" variant="ghost" size="sm" className="text-amber-200 underline" onClick={props.onConflictOpen}>存在尚未处理的版本冲突</Button> : null}
      <ConflictResolutionModal
        open={props.conflictOpen && Boolean(props.conflict)}
        title="合并 Inbox 版本冲突"
        description="服务端内容或状态已变化。本地输入与首次提交基线均已保留，系统不会自动采用、覆盖或重放。"
        conflictFields={props.conflict?.conflictFields ?? []}
        comparisons={props.conflict ? buildPlanInboxConflictComparisons(draft, props.baseRevision, item, props.conflict, props.pendingConvert) : []}
        onClose={props.onConflictClose}
        onAdoptServer={() => { if (props.conflict) props.onApplyServerVersion(props.conflict.latest); }}
        onManualMerge={() => { if (props.conflict) props.onAdoptLatestRevision(props.conflict.latest); }}
        mergeLabel="保留本地输入并人工合并"
      />
    </section>
  );
}
