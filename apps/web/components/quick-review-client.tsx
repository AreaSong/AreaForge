"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReviewScheduleDto } from "@/lib/study/review-schedule-service";

const DRAFT_PREFIX = "areaforge.quick-review.";

function readQuickReviewDraft(scheduleId: string) {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(`${DRAFT_PREFIX}${scheduleId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as {
      result?: "PASSED" | "PARTIAL" | "FAILED";
      durationSeconds?: number;
      nextDueDate?: string;
      note?: string;
    };
  } catch {
    return null;
  }
}

export function QuickReviewClient(props: { schedule: ReviewScheduleDto; returnTo: string }) {
  const router = useRouter();
  const saved = readQuickReviewDraft(props.schedule.id);
  const [result, setResult] = useState<"PASSED" | "PARTIAL" | "FAILED">(saved?.result ?? "PARTIAL");
  const [durationSeconds, setDurationSeconds] = useState(saved?.durationSeconds ?? 300);
  const [nextDueDate, setNextDueDate] = useState(saved?.nextDueDate ?? "");
  const [note, setNote] = useState(saved?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [revealed, setRevealed] = useState(props.schedule.targetType !== "MISTAKE");

  useEffect(() => {
    window.sessionStorage.setItem(
      `${DRAFT_PREFIX}${props.schedule.id}`,
      JSON.stringify({ result, durationSeconds, nextDueDate, note }),
    );
  }, [props.schedule.id, result, durationSeconds, nextDueDate, note]);

  if (props.schedule.status === "PAUSED") {
    return (
      <section className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-3 px-4">
        <h1 className="text-2xl font-semibold text-white">排期已暂停</h1>
        <p className="text-sm text-zinc-400">暂停的 Schedule 不能开始快速复习。</p>
        <Link href={props.returnTo} className="text-teal-300 hover:underline">
          返回
        </Link>
      </section>
    );
  }

  async function confirm() {
    setError(null);
    const response = await fetch(`/api/review-schedules/${props.schedule.id}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        result,
        durationSeconds,
        nextDueDate: nextDueDate || undefined,
        note: note || undefined,
        expectedRevision: props.schedule.revision,
        idempotencyKey: `qr-${props.schedule.id}-${props.schedule.revision}-${Date.now()}`,
      }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setError(body?.error ?? "确认失败");
      return;
    }
    window.sessionStorage.removeItem(`${DRAFT_PREFIX}${props.schedule.id}`);
    setDone(true);
  }

  function discardDraft() {
    window.sessionStorage.removeItem(`${DRAFT_PREFIX}${props.schedule.id}`);
    router.replace(props.returnTo);
  }

  if (done) {
    return (
      <section className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-4">
        <h1 className="text-2xl font-semibold text-white">本次复习已确认</h1>
        <p className="text-sm text-zinc-400">停留结果页。只有你点下一项才会继续。</p>
        <Link href="/today" className="text-teal-300 hover:underline">
          下一项 / 回今日
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto flex min-h-screen max-w-xl flex-col gap-5 px-4 py-8">
      <Link href={props.returnTo} className="text-sm text-zinc-400 hover:text-zinc-200">
        离开（草稿仅本地）
      </Link>
      <div>
        <p className="text-sm text-teal-300">{props.schedule.targetType}</p>
        <h1 className="mt-2 text-3xl font-semibold text-white">快速复习</h1>
        <p className="mt-2 text-sm text-zinc-400">到期日 {props.schedule.dueDate ?? "无"}</p>
      </div>

      {props.schedule.targetType === "MISTAKE" && !revealed ? (
        <div className="rounded-md border border-white/10 bg-[#101419] p-4">
          <p className="text-sm text-zinc-300">错题揭示前门禁：请确认已作答或完成纸上/口头作答。</p>
          <button type="button" className="mt-3 h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black" onClick={() => setRevealed(true)}>
            已作答，继续
          </button>
        </div>
      ) : (
        <div className="space-y-3 rounded-md border border-white/10 bg-[#101419] p-4">
          <label className="block text-sm">
            结果
            <select className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={result} onChange={(e) => setResult(e.target.value as typeof result)}>
              <option value="PASSED">通过</option>
              <option value="PARTIAL">部分</option>
              <option value="FAILED">失败</option>
            </select>
          </label>
          <label className="block text-sm">
            时长（秒）
            <input type="number" min={1} max={14400} className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={durationSeconds} onChange={(e) => setDurationSeconds(Number(e.target.value) || 1)} />
          </label>
          <label className="block text-sm">
            下次日期（可选）
            <input type="date" className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} />
          </label>
          <label className="block text-sm">
            备注
            <textarea className="mt-1 min-h-20 w-full rounded-md border border-white/10 bg-[#151a20] px-2 py-2" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black" onClick={() => void confirm()}>
              确认本次复习
            </button>
            <button type="button" className="h-11 rounded-md border border-white/10 px-4 text-sm" onClick={discardDraft}>
              丢弃草稿
            </button>
          </div>
        </div>
      )}

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </section>
  );
}
