"use client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { formatDateTime } from "@/lib/formatters";
import type { DeletionIntentView } from "@/lib/contracts/data-deletion";
import { deletionError, deletionStates } from "./data-deletion-labels";

export function DeletionRecords(props: { intents: DeletionIntentView[]; busy: boolean; enabled: boolean;
  control: (row: DeletionIntentView, action: "cancel" | "restore" | "retry") => void }) {
  if (!props.intents.length) return <p className="rounded-xl border border-dashed border-white/15 p-4 text-sm text-zinc-400">还没有回收站对象或删除请求。</p>;
  return <div className="space-y-3">{props.intents.map(row => <Card key={row.id} variant="subtle" className="min-w-0 space-y-3 p-4" data-deletion-id={row.id}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong className="text-sm">{row.scope === "ACCOUNT" ? "账户删除" : row.scope === "WORKSPACE" ? "工作区删除" : "回收站对象"}</strong>
      <Badge tone={row.state === "SUCCEEDED" || row.state === "RESTORED" ? "success" : row.state === "FAILED" ? "danger" : "warning"}>{deletionStates[row.state] ?? "待核对"}</Badge>
    </div>
    <p className="text-sm text-zinc-300">{Object.values(row.counts).reduce((sum, count) => sum + count, 0)} 项记录 · <span className="font-mono text-xs">{row.id.slice(0, 12)}</span></p>
    {!row.completedAt && <p className="text-sm text-zinc-400">{row.scope === "RESOURCE" ? "可恢复至" : "最早开始于"} {formatDateTime(row.availableAt)}</p>}
    {row.irreversible && row.state !== "SUCCEEDED" && <p className="text-sm text-amber-200">已进入不可逆处理，不能取消；中断后由后台核对并恢复处理。</p>}
    {row.errorCode && <p className="text-sm text-rose-200">{deletionError(row.errorCode)}</p>}
    <div className="flex flex-wrap gap-2">
      {row.canRestore && <Button size="lg" disabled={props.busy} onClick={() => props.control(row, "restore")}>恢复对象</Button>}
      {row.canCancel && <Button size="lg" disabled={props.busy} onClick={() => props.control(row, "cancel")}>取消删除</Button>}
      {row.canRetry && <Button size="lg" disabled={props.busy || !props.enabled} onClick={() => props.control(row, "retry")}>重新确认并重试</Button>}
    </div>
  </Card>)}</div>;
}
