"use client";

import type { RankingRebuildJobView } from "@areaforge/core";
import { Button } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { useRankingRebuild } from "./ranking-rebuild-controller";

const statusNames: Record<RankingRebuildJobView["status"], string> = {
  QUEUED: "排队中", RUNNING: "重建中", PAUSED: "已暂停", CANCEL_REQUESTED: "等待取消", CANCELLED: "已取消",
  SUCCEEDED: "成功", FAILED: "失败", EXPIRED: "已过期",
};
const controls = { PAUSE: "暂停", RESUME: "恢复", CANCEL: "取消", REPLAY: "重试" } as const;

export function RankingRebuildPanel(props: { challengeId: string; actorId: string; revision: number; canManage: boolean; canRequest: boolean }) {
  const state = useRankingRebuild(props);
  const active = state.jobs.some(job => ["QUEUED", "RUNNING", "PAUSED", "CANCEL_REQUESTED"].includes(job.status) || (job.status === "FAILED" && job.retryable));
  return <section aria-label="排名重建" data-ranking-challenge-id={props.challengeId} className="min-w-0 space-y-3 border-t border-white/10 pt-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-medium text-white">持久排名与重建</h3>
      <div className="flex flex-wrap gap-2">
        <Button className="min-h-11" type="button" disabled={state.pending} variant="secondary" onClick={() => void state.refresh()}>刷新排名</Button>
        {props.canManage && props.canRequest ? <Button className="min-h-11" type="button" disabled={state.pending || !state.enabled || (active && !state.retrySame)}
          onClick={() => void state.request()}>{state.retrySame ? "重试同一重建请求" : "申请重建排名"}</Button> : null}
      </div>
    </div>
    {state.notice ? <Alert tone="info" role="status">{state.notice}</Alert> : null}
    {props.canManage && state.disabled ? <p className="text-xs text-zinc-400">持久重建当前关闭；已有任务仍可查看和取消。</p> : null}
    {props.canManage && state.jobs[0] ? <RankingJobRow job={state.jobs[0]} pending={state.pending}
      enabled={state.enabled} onControl={action => void state.control(state.jobs[0]!, action)} /> : null}
    <div aria-label="当前排名" className="space-y-2">
      {!state.projection || state.projection.stale ? <p className="text-xs text-zinc-400">暂无可验证的当前排名；权限或来源变化后需重新申请重建。</p>
        : state.projection.entries.length === 0 ? <p className="text-xs text-zinc-400">当前没有符合计分条件的参与者。</p>
          : state.projection.entries.map(entry => <div key={entry.participantId} data-ranking-participant-id={entry.participantId}
            className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg bg-white/[0.025] px-3 py-2 text-sm">
            <span className="min-w-0 break-words">第 {entry.rank} 名 · {entry.displayName}{entry.tied ? "（并列）" : ""}</span>
            <span className="tabular-nums text-teal-200">{entry.fields.score ?? "—"} 分</span>
          </div>)}
    </div>
    {props.canManage && state.jobs.length > 1 ? <details className="space-y-2 text-xs text-zinc-400">
      <summary className="min-h-11 cursor-pointer py-3">重建历史（{state.jobs.length - 1}）</summary>
      <div className="space-y-2">{state.jobs.slice(1).map(job => <RankingJobRow key={job.id} job={job} pending={state.pending}
        enabled={state.enabled} onControl={action => void state.control(job, action)} />)}</div>
    </details> : null}
  </section>;
}

function RankingJobRow(props: { job: RankingRebuildJobView; pending: boolean; enabled: boolean;
  onControl: (action: RankingRebuildJobView["controls"][number]) => void }) {
  const { job } = props;
  const status = job.pauseRequested ? "等待安全暂停" : job.status === "FAILED" && job.retryable ? "等待重试" : statusNames[job.status];
  return <div data-ranking-job-id={job.id} className="space-y-2 rounded-xl border border-white/10 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Badge tone={job.status === "SUCCEEDED" ? "success" : undefined}>{status}</Badge>
      <span className="text-xs tabular-nums text-zinc-400">尝试 {job.attempt}/{job.maxAttempts} · {Math.round(job.progress * 100)}%</span>
    </div>
    <div role="progressbar" aria-label="重建进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)}
      className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-teal-400" style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
    {job.errorCode ? <p className="break-words text-xs text-amber-200">{job.errorCode} · {job.deadLettered ? "已停止自动尝试" : "保留任务与审计"}</p> : null}
    <div className="flex flex-wrap gap-2">{job.controls.map(action => <Button key={action} className="min-h-11" type="button" variant="secondary"
      disabled={props.pending || (!props.enabled && action !== "CANCEL")} onClick={() => props.onControl(action)}>{controls[action]}</Button>)}</div>
  </div>;
}
