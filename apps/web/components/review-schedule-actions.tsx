"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReviewScheduleActions(props: { id: string; status: "ACTIVE" | "PAUSED"; revision: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    const action = props.status === "ACTIVE" ? "pause" : "resume";
    const response = await fetch(`/api/review-schedules/${props.id}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(props.status === "ACTIVE"
        ? { expectedRevision: props.revision, reason: "用户主动暂停" }
        : { expectedRevision: props.revision, dueDate: new Date().toISOString() }),
    });
    const body = await response.json().catch(() => null) as { error?: string } | null;
    setPending(false);
    if (!response.ok) {
      setError(body?.error ?? "排期状态更新失败");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <button type="button" disabled={pending} onClick={() => void submit()} className="h-10 rounded-md bg-teal-500 px-4 text-sm font-medium text-black disabled:opacity-60">
        {pending ? "处理中..." : props.status === "ACTIVE" ? "暂停排期" : "恢复排期"}
      </button>
      {error ? <p className="mt-2 text-sm text-red-300" role="alert">{error}</p> : null}
    </div>
  );
}
