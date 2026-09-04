import Link from "next/link";
import { CalendarDays, Clock3, Pencil } from "lucide-react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { DetailHeading } from "@/components/detail-heading";
import { PlanInboxOriginSummary, planInboxOriginLabel } from "@/components/plan-inbox-origin";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { PinnedActionBar } from "@/components/ui/pinned-action-bar";
import type { PlanInboxFormOptions, PlanInboxItemDto } from "@/lib/contracts";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import {
  buildPlanInboxConflictComparisons,
  detailHref,
  getPlanInboxMissingFields,
  isPlanInboxEditorFieldVisible,
  planInboxStatusLabel,
  shanghaiDateOffset,
  type DependencyType,
  type PendingPlanInboxConvert,
  type PlanInboxConflict,
  type PlanInboxFormDraft,
  type PlanInboxEditorFields,
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
  editorFields: PlanInboxEditorFields;
  onDraftChange: (patch: Partial<PlanInboxFormDraft>) => void;
  onToggleRelated: (nodeId: string) => void;
  onTogglePredecessor: (taskId: string) => void;
  onDependencyTypeChange: (taskId: string, dependencyType: DependencyType) => void;
  onRetryUnknownConvert: () => void;
  onSave: () => void;
  onConvert: () => void;
  onTransition: (action: "dismiss" | "reopen") => void;
  onCreateRequiredMilestone: () => void;
  onOpenAllFields: () => void;
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
  const localMissing = getPlanInboxMissingFields(draft, item.requiredMilestoneKey);
  const localMissingLabels = localMissing.map((field) => field.label);
  const readOnly = item.status === "CONVERTED" || Boolean(item.supersededByItemId) || Boolean(props.pendingConvert);

  return (
    <section className="space-y-6 pb-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <Link href={props.returnTo} className="inline-flex text-sm text-zinc-400 hover:text-teal-300 transition-colors">
          ← 返回收件箱
        </Link>
        <div className="flex items-center gap-2">
          <Badge tone={item.status === "CONVERTED" ? "success" : item.status === "DISMISSED" ? "neutral" : "warning"}>
            {planInboxStatusLabel(item.status)}
          </Badge>
          <span className="text-xs text-zinc-500">版本 {item.revision}</span>
        </div>
      </div>

      <header className="space-y-2">
        <p className="text-xs font-semibold text-teal-300">{planInboxOriginLabel(item.originType)}</p>
        <DetailHeading className="text-2xl sm:text-3xl font-bold text-white">
          {item.originType === "DAILY_REVIEW_MINIMUM" ? "安排明日最低行动" : "投入草稿"}
        </DetailHeading>
      </header>

      {item.supersededByItemId ? (
        <Card variant="accent" className="border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-200">
          已被新版本取代。
          <Link
            href={withReturnTo(`/roadmap/allocation/drafts/${item.supersededByItemId}`, detailHref(item.id, props.returnTo))}
            className="ml-2 text-teal-300 hover:underline"
          >
            查看最新
          </Link>
        </Card>
      ) : null}

      {props.pendingConvert ? (
        <Card variant="accent" className="flex flex-wrap items-center justify-between gap-3 border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-100">
          <span>上次转换结果未知；草稿、revision 与命令身份均已保留，不会自动重放。</span>
          <Button type="button" disabled={props.busy} variant="secondary" size="sm" onClick={props.onRetryUnknownConvert}>
            {props.busy ? "确认中..." : "确认上次转换结果"}
          </Button>
        </Card>
      ) : null}

      <Card variant="subtle" className="p-5">
        <PlanInboxOriginSummary item={item} returnTo={detailHref(item.id, props.returnTo)} />
      </Card>

      <Card variant="subtle" className="p-4">
        <details>
          <summary className="cursor-pointer text-xs font-medium text-zinc-400 hover:text-zinc-200">高级来源信息 (Snapshot)</summary>
          <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-black/30 p-3 whitespace-pre-wrap font-mono text-xs text-zinc-400">{JSON.stringify(item.originSnapshot, null, 2)}</pre>
        </details>
      </Card>

      {props.editorFields !== null ? <Card variant="master" className="space-y-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <h2 className="text-base font-semibold text-white">
              {props.editorFields === "all" ? "调整安排" : "补全转换所需信息"}
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              {props.editorFields === "all" ? "修改会在转换时一并保存。" : `只需补充：${localMissingLabels.join("、") || "必填字段已完整"}。`}
            </p>
          </div>
          {props.editorFields !== "all" ? (
            <Button type="button" variant="ghost" size="sm" onClick={props.onOpenAllFields}>
              <Pencil className="size-4" aria-hidden="true" />调整其他安排
            </Button>
          ) : null}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {isPlanInboxEditorFieldVisible(props.editorFields, "title") ? <Field label="标题" htmlFor="inbox-draft-title" className="sm:col-span-2">
            <Input id="inbox-draft-title" disabled={readOnly} value={draft.title} onChange={(event) => props.onDraftChange({ title: event.target.value })} />
          </Field> : null}
          {isPlanInboxEditorFieldVisible(props.editorFields, "subjectId") ? <Field label="科目" htmlFor="inbox-draft-subject">
            <Select
              id="inbox-draft-subject"
              disabled={readOnly}
              value={draft.subjectId}
              onChange={(event) => props.onDraftChange({ subjectId: event.target.value, primaryNodeId: "", relatedNodeIds: [] })}
            >
              <option value="">请选择</option>
              {props.options.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </Select>
          </Field> : null}
          {isPlanInboxEditorFieldVisible(props.editorFields, "plannedDate") ? <div>
            <Field label="计划日期" htmlFor="inbox-draft-date">
              <Input id="inbox-draft-date" disabled={readOnly} type="date" value={draft.plannedDate} onChange={(event) => props.onDraftChange({ plannedDate: event.target.value })} />
            </Field>
            {!readOnly ? (
              <div className="mt-2 flex gap-2" aria-label="快捷安排日期">
                <Button type="button" variant="ghost" size="sm" className="text-teal-300 hover:bg-teal-400/10" onClick={() => props.onDraftChange({ plannedDate: shanghaiDateOffset(0) })}>今天</Button>
                <Button type="button" variant="ghost" size="sm" className="text-teal-300 hover:bg-teal-400/10" onClick={() => props.onDraftChange({ plannedDate: shanghaiDateOffset(1) })}>明天</Button>
              </div>
            ) : null}
          </div> : null}
          {isPlanInboxEditorFieldVisible(props.editorFields, "estimatedMinutes") ? <Field label="预计时长（分钟）" htmlFor="inbox-draft-minutes">
            <Input id="inbox-draft-minutes" disabled={readOnly} type="number" min="1" max="1440" value={draft.estimatedMinutes} onChange={(event) => props.onDraftChange({ estimatedMinutes: event.target.value })} />
          </Field> : null}
          {props.editorFields === "all" ? <Field label="优先级" htmlFor="inbox-draft-priority">
            <Select id="inbox-draft-priority" disabled={readOnly} value={draft.priority} onChange={(event) => props.onDraftChange({ priority: event.target.value })}>
              <option value="LOW">低</option>
              <option value="MEDIUM">中</option>
              <option value="HIGH">高</option>
              <option value="CRITICAL">关键</option>
            </Select>
          </Field> : null}
          {props.editorFields === "all" ? <Field label="类型" htmlFor="inbox-draft-type">
            <Input id="inbox-draft-type" disabled={readOnly} value={draft.type} onChange={(event) => props.onDraftChange({ type: event.target.value })} />
          </Field> : null}
          {isPlanInboxEditorFieldVisible(props.editorFields, "planMilestoneId") || props.editorFields === "all" ? <Field label="里程碑" htmlFor="inbox-draft-milestone">
            <Select id="inbox-draft-milestone" disabled={readOnly} value={draft.planMilestoneId} onChange={(event) => props.onDraftChange({ planMilestoneId: event.target.value })}>
              <option value="">不关联</option>
              {milestones.map((milestone) => <option key={milestone.id} value={milestone.id}>{milestone.title}</option>)}
            </Select>
          </Field> : null}
          {props.editorFields === "all" ? <Field label="主考纲节点" htmlFor="inbox-draft-primary-node" className="sm:col-span-2">
            <Select id="inbox-draft-primary-node" disabled={readOnly} value={draft.primaryNodeId} onChange={(event) => props.onDraftChange({ primaryNodeId: event.target.value })}>
              <option value="">不关联</option>
              {nodes.map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}
            </Select>
          </Field> : null}
        </div>

        {props.editorFields === "all" ? <div className="space-y-2 border-t border-white/10 pt-4">
          <legend className="text-xs font-semibold text-zinc-300">相关考纲节点</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            {nodes.filter((node) => node.id !== draft.primaryNodeId).map((node) => (
              <label key={node.id} className="flex min-w-0 items-center gap-2 text-xs text-zinc-300 hover:text-white cursor-pointer">
                <Checkbox checked={draft.relatedNodeIds.includes(node.id)} onChange={() => props.onToggleRelated(node.id)} />
                <span className="min-w-0 flex-1 truncate">{node.title}</span>
              </label>
            ))}
            {nodes.length === 0 ? <p className="text-xs text-zinc-500">选择科目后显示节点。</p> : null}
          </div>
        </div> : null}

        {props.editorFields === "all" ? <div className="space-y-2 border-t border-white/10 pt-4">
          <legend className="text-xs font-semibold text-zinc-300">现有任务前置依赖</legend>
          <div className="space-y-2 pt-1">
            {tasks.map((task) => {
              const entry = draft.predecessors.find((value) => value.taskId === task.id);
              return (
                <div key={task.id} className="flex min-w-0 flex-wrap items-center gap-3 text-xs">
                  <label className="flex min-w-0 flex-1 items-center gap-2 cursor-pointer">
                    <Checkbox checked={Boolean(entry)} onChange={() => props.onTogglePredecessor(task.id)} />
                    <span className="min-w-0 flex-1 truncate text-zinc-300 hover:text-white">{task.subjectName} · {task.title}</span>
                  </label>
                  {entry ? (
                    <Select
                      aria-label={`${task.title} 依赖类型`}
                      className="h-8 px-2 text-xs"
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
            {tasks.length === 0 ? <p className="text-xs text-zinc-500">当前工作区没有可用前置任务。</p> : null}
          </div>
        </div> : null}

        {item.dependencyRefs.filter((ref) => ref.targetType === "INBOX_STABLE_REF").map((ref) => (
          <p key={ref.id} className="text-xs text-amber-200">
            前置计划 <Link className="text-teal-300 hover:underline" href={withReturnTo(`/roadmap/allocation/drafts?stableRef=${encodeURIComponent(`${ref.planStableKey ?? ""}@${ref.planOriginVersion ?? ""}`)}`, detailHref(item.id, props.returnTo))}>{ref.planStableKey}@{ref.planOriginVersion ?? "?"}</Link> 必须先转换（{ref.dependencyType}）。
          </p>
        ))}
        {props.dirty ? (
          <div className="flex justify-end border-t border-white/10 pt-4">
            <Button type="button" variant="secondary" size="md" disabled={props.busy} onClick={props.onSave}>
              {props.busy ? "正在保存..." : "保存当前修改"}
            </Button>
          </div>
        ) : null}
      </Card> : null}

      <Card variant="subtle" className="p-5 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">转换预览</h2>
            <p className="mt-1 text-sm font-medium text-zinc-200">{draft.title || "待补标题"}</p>
          </div>
          {props.editorFields === null && item.status === "OPEN" && !readOnly ? (
            <Button type="button" variant="secondary" size="sm" onClick={props.onOpenAllFields}>
              <Pencil className="size-4" aria-hidden="true" />调整安排
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-400">
          <span>{props.options.subjects.find((subject) => subject.id === draft.subjectId)?.name ?? "待补科目"}</span>
          <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5" aria-hidden="true" />{draft.plannedDate || "待补日期"}</span>
          <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" aria-hidden="true" />{draft.estimatedMinutes ? `${draft.estimatedMinutes} 分钟` : "待补时长"}</span>
        </div>
        <p className="text-xs text-zinc-500">将创建 1 个正式任务、{draft.relatedNodeIds.length} 个相关节点关系、{draft.predecessors.length + item.dependencyRefs.filter((ref) => ref.targetType === "INBOX_STABLE_REF").length} 条前置依赖。</p>
        {localMissing.length ? (
          <p className="text-xs font-medium text-amber-300">尚缺：{localMissingLabels.join("、")}</p>
        ) : (
          <p className="text-xs font-medium text-emerald-300">必填字段完整。</p>
        )}
      </Card>

      {props.error ? <p role="alert" className="text-sm text-red-300">{props.error}</p> : null}

      {item.requiredMilestoneKey && !draft.planMilestoneId ? (
        <Card variant="accent" className="flex flex-wrap items-center gap-3 p-4 text-xs text-amber-200 border-amber-400/30">
          <span>此草稿引用 canonical 里程碑 {item.requiredMilestoneKey}。</span>
          <Button type="button" variant="ghost" size="sm" className="text-teal-300 underline" disabled={props.busy || Boolean(props.pendingConvert) || !props.options.stagePlans.length} onClick={props.onCreateRequiredMilestone}>创建并选中</Button>
          {!props.options.stagePlans.length ? <Link className="text-teal-300 hover:underline" href={withReturnTo("/roadmap/stages", detailHref(item.id, props.returnTo))}>先创建阶段计划</Link> : null}
        </Card>
      ) : null}

      {props.conflict ? (
        <Button type="button" variant="ghost" size="sm" className="text-amber-200 underline" onClick={props.onConflictOpen}>
          存在尚未处理的版本冲突
        </Button>
      ) : null}

      <PinnedActionBar
        mode="sticky"
        left={
          <div className="flex items-center gap-2.5">
            <Badge tone={localMissing.length ? "warning" : "success"}>
              {localMissing.length ? `尚缺 ${localMissingLabels.join("、")}` : "可转换"}
            </Badge>
            {props.dirty ? <span className="text-xs text-zinc-400">有未保存修改</span> : null}
          </div>
        }
        right={
          <div className="flex flex-wrap items-center gap-2">
            {item.status === "OPEN" && !readOnly ? (
              <>
                <Button type="button" variant="primary" size="md" disabled={props.busy || localMissing.length > 0} onClick={props.onConvert}>
                  {props.busy ? "正在转换..." : "转换为正式任务"}
                </Button>
                <Button type="button" variant="ghost" size="md" disabled={props.busy} onClick={() => props.onTransition("dismiss")}>
                  忽略
                </Button>
              </>
            ) : null}
            {item.status === "DISMISSED" && !item.supersededByItemId ? (
              <Button type="button" variant="secondary" size="md" disabled={props.busy || Boolean(props.pendingConvert)} onClick={() => props.onTransition("reopen")}>
                恢复 / Undo
              </Button>
            ) : null}
            {item.convertedTaskId ? (
              <ButtonLink href={withReturnTo(`/roadmap/allocation/tasks/${item.convertedTaskId}`, props.returnTo)} variant="primary" size="md">
                打开任务
              </ButtonLink>
            ) : null}
          </div>
        }
      />

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
