"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReviewEventDto } from "@/lib/study/review-schedule-service";

type Result = "PASSED" | "PARTIAL" | "FAILED";

export function ReviewEventCorrection(props: { event: ReviewEventDto; scheduleRevision: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Result>(props.event.result);
  const [nextDueDate, setNextDueDate] = useState("");
  const [note, setNote] = useState(props.event.note ?? "");
  const [idempotencyKey] = useState(() => `review-correction-${props.event.id}-${crypto.randomUUID()}`);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    setSubmitting(true);
    const response = await fetch(`/api/review-events/${props.event.id}/corrections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey,
        expectedRevision: props.scheduleRevision,
        result,
        nextDueDate: nextDueDate || undefined,
        note: note || undefined,
      }),
    });
    const body = await response.json().catch(() => null) as { error?: string; conflictFields?: string[] } | null;
    setSubmitting(false);
    if (!response.ok) {
      setError(`${body?.error ?? "更正失败"}${body?.conflictFields?.length ? `（${body.conflictFields.join("、")}）` : ""}`);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return <button type="button" className="mt-2 text-xs text-teal-300 hover:underline" onClick={() => setOpen(true)}>更正最新结果</button>;
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border border-white/10 bg-black/20 p-3">
      <p className="text-xs text-zinc-400">更正会追加新事件，原事件保持不变，时长沿用 {props.event.durationSeconds} 秒。</p>
      <label className="block text-sm">结果<select className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={result} onChange={(event) => setResult(event.target.value as Result)}><option value="PASSED">通过</option><option value="PARTIAL">部分</option><option value="FAILED">失败</option></select></label>
      <label className="block text-sm">下次日期（可选）<input type="date" className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={nextDueDate} onChange={(event) => setNextDueDate(event.target.value)} /></label>
      <label className="block text-sm">更正备注<textarea className="mt-1 min-h-20 w-full rounded-md border border-white/10 bg-[#151a20] px-2 py-2" value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <div className="flex gap-2"><button type="button" disabled={submitting} className="h-10 rounded-md bg-teal-500/90 px-3 text-sm font-medium text-black disabled:opacity-50" onClick={() => void submit()}>{submitting ? "提交中..." : "提交更正"}</button><button type="button" className="h-10 rounded-md border border-white/10 px-3 text-sm" onClick={() => setOpen(false)}>取消</button></div>
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
    </div>
  );
}
