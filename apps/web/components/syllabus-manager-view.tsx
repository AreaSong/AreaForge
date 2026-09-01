import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import type { SyllabusManagerController } from "@/components/syllabus-manager-controller";
import { SyllabusManagerCreateDrawer } from "@/components/syllabus-manager-create-drawer";
import {
  ActionFilterButton,
  MapStatusButton,
  StatusFilterButton,
  SummaryMetric,
} from "@/components/syllabus-manager-filter-controls";
import {
  actionFilterOptions,
  labelMapCell,
  labelMapRisk,
  labelStatus,
  mapStatusOptions,
  statusFilterOptions,
} from "@/components/syllabus-manager-labels";
import { buildSyllabusConflictComparisons } from "@/components/syllabus-manager-support";
import { SyllabusTreeNode } from "@/components/syllabus-manager-tree-node";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Select } from "@/components/ui/field";
import { Toolbar } from "@/components/ui/page";
import { Plus } from "lucide-react";

export function SyllabusManagerView({ controller }: { controller: SyllabusManagerController }) {
  const { runtime, workbench, create, nodes } = controller;
  const conflict = nodes.state.conflict;

  return (
    <>
      <SyllabusManagerCreateDrawer controller={controller} />
      {!create.state.createOpen && runtime.error ? <p className="text-sm text-red-200">{runtime.error}</p> : null}

      <Toolbar label="考纲筛选">
        <Select
          aria-label="筛选考纲科目"
          className="min-w-0"
          value={workbench.subjectId}
          onChange={(event) => workbench.applyFilters({ subject: event.target.value })}
        >
          {workbench.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
        </Select>
        {workbench.initialQuery ? <Badge tone="info">搜索：{workbench.initialQuery}</Badge> : null}
        {workbench.hasWorkbenchFilters ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => workbench.applyFilters({ status: "all", map: "all", action: "all" })}>
            清除筛选
          </Button>
        ) : null}
      </Toolbar>

      <Card variant="master" className="min-w-0 p-5 sm:p-6">
        <WorkbenchHeading controller={controller} />
        <WorkbenchSummary controller={controller} />
        <StatusFilters controller={controller} />
        <SyllabusNodeList controller={controller} />
      </Card>


      <ConflictResolutionModal
        open={conflict !== null}
        title="考纲节点已被其他页面更新"
        description="旧 revision 已失效。系统不会自动覆盖任何一方；请选择采用服务端，或保留本地输入并在检查差异后再次明确提交。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={conflict ? buildSyllabusConflictComparisons(conflict) : []}
        onAdoptServer={nodes.actions.adoptConflict}
        onManualMerge={nodes.actions.mergeConflict}
      />
    </>
  );
}

function WorkbenchHeading({ controller }: { controller: SyllabusManagerController }) {
  const { workbench, create } = controller;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm text-zinc-400">作战地图</p>
        <h2 className="mt-1 text-xl font-semibold text-white">
          {workbench.subjects.find((subject) => subject.id === workbench.subjectId)?.name ?? "未选择科目"}
        </h2>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-300">
          {workbench.filteredNodeCount} / {workbench.subjectFlatNodeCount} 个节点
        </span>
        <Button type="button" variant="primary" onClick={() => create.actions.setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          新增节点
        </Button>
      </div>
    </div>
  );
}

function WorkbenchSummary({ controller }: { controller: SyllabusManagerController }) {
  const { workbench } = controller;
  return (
    <div className="mt-5 border-y border-white/10 py-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card variant="subtle" className="p-3.5">
          <SummaryMetric label="覆盖率" value={`${workbench.selectedSummary.coverageRate}%`} />
        </Card>
        <Card variant="subtle" className="p-3.5">
          <SummaryMetric label="验证率" value={`${workbench.selectedSummary.verificationRate}%`} />
        </Card>
        <Card variant="subtle" className="p-3.5">
          <SummaryMetric label="风险等级" value={labelMapRisk(workbench.selectedSummary.riskLevel)} />
        </Card>
      </div>
      <RecommendedMapFilters controller={controller} />
      <div className="mt-4 grid gap-2 text-sm text-zinc-300">
        {workbench.selectedSummary.nextActions.slice(0, 3).map((action) => <p key={action}>{action}</p>)}
      </div>
      <div className="af-content-grid-four mt-4 grid gap-2">
        {mapStatusOptions.map((option) => (
          <MapStatusButton
            key={option}
            active={workbench.mapStatusFilter === option}
            count={workbench.mapStatusCounts[option]}
            label={labelMapCell(option)}
            onClick={() => workbench.applyFilters({ map: workbench.mapStatusFilter === option ? "all" : option })}
          />
        ))}
      </div>
      <ActionFilters controller={controller} />
      <FocusNodes controller={controller} />
    </div>
  );
}

function RecommendedMapFilters({ controller }: { controller: SyllabusManagerController }) {
  const { workbench } = controller;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {workbench.selectedSummary.recommendedFilters.length > 0 ? (
        workbench.selectedSummary.recommendedFilters.map((filter) => (
          <Button
            key={filter}
            variant={workbench.mapStatusFilter === filter ? "secondary" : "ghost"}
            size="sm"
            onClick={() => workbench.applyFilters({ map: workbench.mapStatusFilter === filter ? "all" : filter })}
          >
            {labelMapCell(filter)} {workbench.mapStatusCounts[filter] ?? 0}
          </Button>
        ))
      ) : <Badge>暂无推荐筛选</Badge>}
      {workbench.mapStatusFilter !== "all" ? (
        <Button variant="ghost" size="sm" onClick={() => workbench.applyFilters({ map: "all" })}>清除地图筛选</Button>
      ) : null}
    </div>
  );
}

function ActionFilters({ controller }: { controller: SyllabusManagerController }) {
  const { workbench } = controller;
  return (
    <>
      <div className="af-content-grid-three mt-4 grid gap-2">
        {actionFilterOptions.map((option) => (
          <ActionFilterButton
            key={option.value}
            active={workbench.actionFilter === option.value}
            count={workbench.actionCounts[option.value]}
            label={option.label}
            onClick={() => workbench.applyFilters({ action: workbench.actionFilter === option.value ? "all" : option.value })}
          />
        ))}
      </div>
      {workbench.actionFilter !== "all" ? (
        <Button className="mt-3" variant="ghost" size="sm" onClick={() => workbench.applyFilters({ action: "all" })}>清除行动筛选</Button>
      ) : null}
    </>
  );
}

function FocusNodes({ controller }: { controller: SyllabusManagerController }) {
  const { workbench } = controller;
  if (workbench.focusNodes.length === 0) return null;
  return (
    <div className="mt-4 grid gap-2">
      <p className="text-xs text-zinc-500">优先处理节点</p>
      {workbench.focusNodes.slice(0, 3).map((node) => (
        <Button key={node.id} variant="secondary" className="h-auto justify-start px-3 py-2 text-left" onClick={() => workbench.applyFilters({ map: node.mapSignal.cellStatus })}>
          <span className="min-w-0">
            <span className="block break-words text-sm text-zinc-100">{node.title}</span>
            <span className="mt-1 block break-words text-xs leading-5 text-zinc-400">{labelMapCell(node.mapSignal.cellStatus)} / {node.mapSignal.nextAction}</span>
          </span>
        </Button>
      ))}
    </div>
  );
}

function StatusFilters({ controller }: { controller: SyllabusManagerController }) {
  const { workbench } = controller;
  return (
    <div className="af-content-grid-four mt-5 grid gap-2">
      <StatusFilterButton active={workbench.statusFilter === "all"} count={workbench.subjectFlatNodeCount} label="全部" onClick={() => workbench.applyFilters({ status: "all" })} />
      {statusFilterOptions.map((option) => (
        <StatusFilterButton key={option} active={workbench.statusFilter === option} count={workbench.statusCounts[option]} label={labelStatus(option)} onClick={() => workbench.applyFilters({ status: option })} />
      ))}
    </div>
  );
}

function SyllabusNodeList({ controller }: { controller: SyllabusManagerController }) {
  const { runtime, workbench, nodes } = controller;
  return (
    <div className="mt-5 grid gap-3">
      {nodes.state.restoredSubmission ? (
        <div className="rounded-md border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-50">
          <p>检测到上次未确认终态的节点更新。系统不会自动重放。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={nodes.actions.retryRestoredUpdate} disabled={runtime.pendingCommand !== null}>检查并再次提交</Button>
            <Button type="button" variant="ghost" onClick={nodes.actions.discardRestoredUpdate} disabled={runtime.pendingCommand !== null}>放弃这份草稿</Button>
          </div>
        </div>
      ) : null}
      {workbench.subjectNodes.length === 0 ? (
        <EmptyState title={workbench.initialQuery ? "没有匹配的考纲节点" : "这个科目还没有考纲节点"} description={workbench.initialQuery ? "尝试修改搜索词或切换科目。" : "先建立第一个章节或知识点。"} />
      ) : null}
      {workbench.subjectNodes.length > 0 && workbench.filteredSubjectNodes.length === 0 ? (
        <EmptyState title="当前筛选没有结果" description="调整状态、地图或行动筛选，或清除筛选查看全部节点。" action={<Button size="sm" onClick={() => workbench.applyFilters({ status: "all", map: "all", action: "all" })}>清除筛选</Button>} />
      ) : null}
      {workbench.filteredSubjectNodes.map((node) => (
        <SyllabusTreeNode
          key={`${node.id}:${node.masteryLevel ?? "none"}:${node.masteryConditions.join("|")}`}
          node={node}
          onUpdate={nodes.actions.updateNode}
          onAddMasteryEvidence={nodes.actions.addMasteryEvidence}
          onAddMasteryRetest={nodes.actions.addMasteryRetest}
          pendingCommand={runtime.pendingCommand}
        />
      ))}
    </div>
  );
}
