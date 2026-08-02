"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";

export function ReviewScheduleActions(props: { id: string; status: "ACTIVE" | "PAUSED"; revision: number; returnTo: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumeDate, setResumeDate] = useState("");
  const actionRef = useRef<HTMLButtonElement>(null);

  async function submit() {
    if (props.status === "PAUSED" && !resumeDate) {
      setError("请选择恢复后的首次复习日期。");
      return;
    }
    setPending(true);
    setError(null);
    const action = props.status === "ACTIVE" ? "pause" : "resume";
    try {
      const response = await fetch(`/api/review-schedules/${props.id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(props.status === "ACTIVE"
          ? { expectedRevision: props.revision, reason: "用户主动暂停" }
          : { expectedRevision: props.revision, dueDate: new Date(`${resumeDate}T00:00:00+08:00`).toISOString() }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (response.status === 401) return redirectToLoginWithCurrentLocation();
      if (response.status === 404) {
        router.replace(props.returnTo);
        return;
      }
      if (!response.ok) {
        setError(body?.error ?? "排期状态更新失败，当前状态没有改变；请显式重试。");
        return;
      }
      router.refresh();
      window.requestAnimationFrame(() => actionRef.current?.focus());
    } catch {
      setError("网络不可用，排期状态没有改变；恢复网络后请显式重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div role="group" aria-label="排期操作" aria-busy={pending} className="space-y-2">
      {props.status === "PAUSED" ? (
        <label className="block text-sm text-zinc-400">
          恢复后的首次复习日期
          <input
            type="date"
            required
            value={resumeDate}
            onChange={(event) => setResumeDate(event.target.value)}
            className="mt-1 block h-10 rounded-md border border-white/10 bg-[#151a20] px-2 text-zinc-100"
          />
        </label>
      ) : null}
      <button ref={actionRef} type="button" disabled={pending || (props.status === "PAUSED" && !resumeDate)} onClick={() => void submit()} className="h-10 rounded-md border border-white/10 px-4 text-sm font-medium text-zinc-200 hover:bg-white/[0.06] disabled:opacity-60">
        {pending ? "处理中..." : props.status === "ACTIVE" ? "暂停排期" : "恢复排期"}
      </button>
      <p className="sr-only" aria-live="polite">{pending ? (props.status === "ACTIVE" ? "正在暂停排期" : "正在恢复排期") : ""}</p>
      {error ? <p className="mt-2 text-sm text-red-300" role="alert">{error}</p> : null}
    </div>
  );
}
