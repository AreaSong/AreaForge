"use client";

import { NotebookPen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { DailyReviewDto } from "@/lib/study/types";

interface ReviewFormProps {
  review: DailyReviewDto | null;
}

const moodOptions = ["焦虑", "麻木", "想她", "自责", "有斗志", "很累", "平静", "失控"] as const;

export function ReviewForm({ review }: ReviewFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const currentMood = review?.mood ?? "";
  const hasLegacyMood = currentMood.length > 0 && !moodOptions.includes(currentMood as (typeof moodOptions)[number]);

  async function submit(formData: FormData) {
    setError(null);
    const response = await fetch("/api/reviews/today", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: String(formData.get("summary") ?? ""),
        lostControl: String(formData.get("lostControl") ?? ""),
        keepAction: String(formData.get("keepAction") ?? ""),
        tomorrowMinimum: String(formData.get("tomorrowMinimum") ?? ""),
        mood: String(formData.get("mood") ?? ""),
      }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "保存复盘失败");
      return;
    }

    startTransition(() => router.refresh());
  }

  return (
    <div className="rounded-lg border border-white/10 bg-[#101419] p-5">
      <div className="flex items-center gap-2">
        <NotebookPen className="h-5 w-5 text-teal-300" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-white">晚间复盘</h2>
      </div>
      <form action={submit} className="mt-4 grid gap-3">
        <textarea
          className="min-h-20 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm text-zinc-100"
          name="summary"
          placeholder="今天完成了什么"
          defaultValue={review?.summary ?? ""}
          required
        />
        <textarea
          className="min-h-16 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm text-zinc-100"
          name="lostControl"
          placeholder="今天哪里失控了"
          defaultValue={review?.lostControl ?? ""}
        />
        <input
          className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
          name="keepAction"
          placeholder="今天最该保留的一个动作"
          defaultValue={review?.keepAction ?? ""}
          required
        />
        <input
          className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
          name="tomorrowMinimum"
          placeholder="明天最小必须完成任务"
          defaultValue={review?.tomorrowMinimum ?? ""}
          required
        />
        <select
          className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
          name="mood"
          defaultValue={review?.mood ?? ""}
          aria-label="情绪状态"
        >
          <option value="">不记录情绪状态</option>
          {hasLegacyMood ? <option value={currentMood}>当前记录：{currentMood}</option> : null}
          {moodOptions.map((mood) => (
            <option key={mood} value={mood}>
              {mood}
            </option>
          ))}
        </select>
        <button
          className="h-11 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-50"
          type="submit"
          disabled={isPending}
        >
          {review ? "更新复盘" : "保存复盘"}
        </button>
      </form>
      {review ? (
        <p className="mt-3 text-sm text-zinc-400">
          已记录 {review.totalMinutes} 分钟学习，其中有效 {review.effectiveMinutes} 分钟。
        </p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-red-200">{error}</p> : null}
    </div>
  );
}
