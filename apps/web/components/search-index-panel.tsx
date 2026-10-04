"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { WorkspaceSearchJobView } from "@areaforge/core";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Alert, Badge } from "@/components/ui/feedback";
import { useSearchIndex } from "./search-index-controller";

export function SearchIndexPanel(props: { actorId: string; enabled: boolean; workspaces: Array<{ id: string; name: string }> }) {
  const [selected, setSelected] = useState(props.workspaces[0]?.id ?? "");
  const workspaceId = props.workspaces.some(row => row.id === selected) ? selected : props.workspaces[0]?.id ?? "";
  return <section className="space-y-3" aria-label="我的搜索索引" data-search-index-root>
    <div className="border-b border-white/10 pb-3">
      <h2 className="flex items-center gap-2 text-base font-semibold text-white"><Search className="size-4 text-teal-300" aria-hidden="true" />我的搜索索引</h2>
      <p className="mt-1 text-sm text-zinc-400">只收录你有权查看的名称与标题，不收录正文，也不保存搜索历史。</p>
    </div>
    <label className="block space-y-2 text-sm text-zinc-300">索引工作区
      <Select aria-label="索引工作区" className="min-h-11 w-full" value={workspaceId} onChange={event => setSelected(event.target.value)} disabled={!props.workspaces.length}>
        {props.workspaces.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </Select>
    </label>
    {workspaceId ? <SearchIndexWorkspace key={`${props.actorId}:${workspaceId}`} workspaceId={workspaceId} enabled={props.enabled} />
      : <SectionCard variant="subtle"><p className="text-sm text-zinc-400">没有可用工作区，请先在考试与科目设置中创建或选择工作区。</p></SectionCard>}
  </section>;
}

function SearchIndexWorkspace(props: { workspaceId: string; enabled: boolean }) {
  const state = useSearchIndex(props.workspaceId); const current = props.enabled && state.status?.index?.state === "CURRENT";
  return <SectionCard variant="subtle" className="space-y-4" data-search-index-workspace={props.workspaceId} aria-busy={state.pending}>
    <div className="flex flex-wrap items-center justify-between gap-3" aria-live="polite">
      <Badge tone={current ? "success" : undefined}>{current ? "索引已验证" : "安全直查"}</Badge>
      <span className="text-sm tabular-nums text-zinc-300">{current ? `${state.status!.index!.documentCount} 个名称与标题` : "未验证的索引不会用于搜索"}</span>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button className="min-h-11" disabled={state.pending || !state.status?.enabled || (state.active && !state.retrySame)} onClick={() => void state.request()}>
        {state.pending ? "正在提交…" : state.retrySame ? "重试同一索引请求" : "重建我的索引"}
      </Button>
      <Button className="min-h-11" variant="secondary" disabled={state.pending} onClick={() => void state.refresh()}>刷新索引状态</Button>
    </div>
    {state.notice ? <Alert role="status" tone="info">{state.notice}</Alert> : null}
    {state.status && !state.status.enabled ? <p className="text-sm text-zinc-400">后台索引重建未开启；顶部搜索仍可使用安全直查。</p> : null}
    {state.status?.jobs[0] ? <SearchIndexJob job={state.status.jobs[0]} pending={state.pending} enabled={state.status.enabled}
      onControl={action => void state.control(state.status!.jobs[0]!, action)} /> : null}
    {state.status && state.status.jobs.length > 1 ? <details className="text-sm text-zinc-400">
      <summary className="min-h-11 cursor-pointer py-3">索引重建历史（{state.status.jobs.length - 1}）</summary>
      <div className="space-y-2">{state.status.jobs.slice(1).map(job => <SearchIndexJob key={job.id} job={job} pending={state.pending}
        enabled={state.status!.enabled} onControl={action => void state.control(job, action)} />)}</div>
    </details> : null}
  </SectionCard>;
}

const statuses = { QUEUED: "排队中", RUNNING: "重建中", PAUSED: "已暂停", CANCEL_REQUESTED: "等待取消", SUCCEEDED: "成功", FAILED: "失败", CANCELLED: "已取消", EXPIRED: "已过期" } as const;
const actions = { PAUSE: "暂停", RESUME: "恢复", CANCEL: "取消", REPLAY: "重试" } as const;
function SearchIndexJob(props: { job: WorkspaceSearchJobView; pending: boolean; enabled: boolean; onControl: (action: WorkspaceSearchJobView["controls"][number]) => void }) {
  const job = props.job;
  return <div data-search-index-job={job.id} className="space-y-3 rounded-xl border border-white/10 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Badge tone={job.status === "SUCCEEDED" ? "success" : undefined}>{job.pauseRequested ? "等待安全暂停" : job.status === "FAILED" && job.retryable ? "等待重试" : statuses[job.status]}</Badge>
      <span className="font-mono text-xs text-zinc-400">第 {job.generation} 代 · 尝试 {job.attempt}/{job.maxAttempts}</span>
    </div>
    <div role="progressbar" aria-label="索引重建进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)} className="h-1.5 overflow-hidden rounded-full bg-white/10">
      <div className="h-full bg-teal-400" style={{ width: `${Math.round(job.progress * 100)}%` }} />
    </div>
    {job.errorCode ? <p className="break-words text-xs text-amber-200">{job.errorCode} · {job.deadLettered ? "已停止自动尝试" : "任务已保留，可刷新状态"}</p> : null}
    <div className="flex flex-wrap gap-2">{job.controls.map(action => <Button key={action} className="min-h-11" variant="secondary"
      disabled={props.pending || (!props.enabled && action !== "CANCEL")} onClick={() => props.onControl(action)}>{actions[action]}</Button>)}</div>
  </div>;
}
