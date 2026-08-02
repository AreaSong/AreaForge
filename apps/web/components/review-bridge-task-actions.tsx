"use client";

import { CalendarClock, Check, CircleSlash, TimerReset } from "lucide-react";
import { useRef, useState } from "react";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Button, buttonClassName } from "@/components/ui/button";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";

type ReviewResult = "PASSED" | "PARTIAL" | "FAILED";

export function ReviewBridgeTaskActions(props: {
  taskId: string;
  estimatedMinutes: number;
  reviewSchedule: {
    id: string;
    status: string;
    dueDate: string | null;
    revision: number;
  };
}) {
  const [result, setResult] = useState<ReviewResult>("PARTIAL");
  const [durationSeconds, setDurationSeconds] = useState(String(Math.max(60, props.estimatedMinutes * 60)));
  const [nextDueDate, setNextDueDate] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"complete" | "defer" | "abandon" | null>(null);
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abandonButtonRef = useRef<HTMLButtonElement>(null);

  if (props.reviewSchedule.status !== "ACTIVE") return null;

  async function completeBridge() {
    const seconds = Number(durationSeconds);
    if (!Number.isInteger(seconds) || seconds < 1) {
      setError("请输入有效的复习时长。");
      return;
    }
    const payload = {
      expectedRevision: props.reviewSchedule.revision,
      result,
      durationSeconds: seconds,
      nextDueDate: nextDueDate ? localDateToIso(nextDueDate) : undefined,
      note: note.trim() || null,
    };
    const commandScope = `review-bridge:${props.taskId}:complete`;
    setPending("complete");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/study-tasks/${props.taskId}/bridge-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: getOrCreateIdempotencyKey(commandScope, "review-bridge", payload),
          ...payload,
        }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        setError(body?.error ?? "桥接复习未完成，当前状态没有改变。");
        return;
      }
      completeIdempotentCommand(commandScope);
      setNotice("复习结果已保存，正式任务已完成。");
      window.location.reload();
    } catch {
      setError("网络不可用，复习结果未确认；请使用相同输入显式重试。");
    } finally {
      setPending(null);
    }
  }

  async function deferBridge() {
    if (!nextDueDate) {
      setError("请选择延期后的计划日期。");
      return;
    }
    setPending("defer");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/study-tasks/${props.taskId}/bridge-defer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedScheduleRevision: props.reviewSchedule.revision,
          plannedDate: localDateToIso(nextDueDate),
        }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        setError(body?.error ?? "桥接任务未延期，当前状态没有改变。");
        return;
      }
      setNotice("桥接任务已延期，复习排期已同步。");
      window.location.reload();
    } catch {
      setError("网络不可用，延期结果未确认；请刷新后重试。");
    } finally {
      setPending(null);
    }
  }

  async function abandonBridge() {
    setPending("abandon");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/study-tasks/${props.taskId}/bridge-abandon`, { method: "POST" });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        setError(body?.error ?? "桥接任务未放弃，当前状态没有改变。");
        return;
      }
      setAbandonOpen(false);
      setNotice("桥接任务已放弃，复习排期仍保留。");
      window.location.reload();
    } catch {
      setError("网络不可用，放弃结果未确认；请刷新后重试。");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="space-y-4 border-y border-white/10 py-5" aria-labelledby="review-bridge-actions-heading">
      <div>
        <h2 id="review-bridge-actions-heading" className="text-lg font-semibold text-white">复习桥接</h2>
        <p className="mt-1 text-sm text-zinc-400">这个正式任务必须同时记录复习结果，不能只完成任务状态。</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm text-zinc-300">
          复习结果
          <select className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white" value={result} onChange={(event) => setResult(event.target.value as ReviewResult)} disabled={pending !== null}>
            <option value="PASSED">通过</option>
            <option value="PARTIAL">部分掌握</option>
            <option value="FAILED">未通过</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm text-zinc-300">
          实际复习秒数
          <input className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white" type="number" min="1" step="30" value={durationSeconds} onChange={(event) => setDurationSeconds(event.target.value)} disabled={pending !== null} />
        </label>
        <label className="grid gap-2 text-sm text-zinc-300 sm:col-span-2">
          下次复习或延期日期（可选；延期时必填）
          <input className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white" type="date" value={nextDueDate} onChange={(event) => setNextDueDate(event.target.value)} disabled={pending !== null} />
        </label>
      </div>
      <label className="grid gap-2 text-sm text-zinc-300">
        复习备注（可选）
        <textarea className="min-h-20 rounded-md border border-white/10 bg-[#0d1117] p-3 text-white" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} disabled={pending !== null} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="primary" loading={pending === "complete"} loadingLabel="保存中" disabled={pending !== null} onClick={() => void completeBridge()}>
          <Check size={16} aria-hidden="true" />确认复习并完成
        </Button>
        <Button type="button" variant="secondary" loading={pending === "defer"} loadingLabel="延期中" disabled={pending !== null} onClick={() => void deferBridge()}>
          <CalendarClock size={16} aria-hidden="true" />延期
        </Button>
        <button ref={abandonButtonRef} type="button" className={buttonClassName({ variant: "danger", size: "md" })} disabled={pending !== null} onClick={() => setAbandonOpen(true)}>
          <CircleSlash size={16} aria-hidden="true" />放弃桥接
        </button>
      </div>
      {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-teal-200">{notice}</p> : null}
      <p className="flex items-center gap-2 text-xs text-zinc-500"><TimerReset size={14} aria-hidden="true" />重复提交同一复习结果会复用同一幂等命令。</p>
      <ConfirmationDialog
        open={abandonOpen}
        title="放弃复习桥接？"
        description="这会把正式任务标记为已放弃，但不会删除复习排期。"
        confirmLabel="确认放弃"
        pending={pending === "abandon"}
        pendingLabel="放弃中"
        onConfirm={() => void abandonBridge()}
        onClose={() => setAbandonOpen(false)}
        returnFocusRef={abandonButtonRef}
      />
    </section>
  );
}

function localDateToIso(value: string): string {
  return new Date(`${value}T00:00:00+08:00`).toISOString();
}
