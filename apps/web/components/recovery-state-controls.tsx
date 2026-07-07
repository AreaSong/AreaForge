"use client";

import { CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { TodayDashboardDto } from "@/lib/study/types";

interface RecoveryStateControlsProps {
  recovery: TodayDashboardDto["recovery"];
}

export function RecoveryStateControls({ recovery }: RecoveryStateControlsProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function mutate(path: string, body: unknown) {
    setError(null);
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "恢复状态更新失败");
      return;
    }

    startTransition(() => router.refresh());
  }

  if (!recovery.active) {
    return (
      <div className="mt-3">
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-300/25 px-3 text-sm text-amber-100 hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={isPending}
          onClick={() => mutate("/api/recovery-states/manual", {})}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          我需要恢复
        </button>
        {error ? <p className="mt-2 text-xs text-red-200">{error}</p> : null}
      </div>
    );
  }

  const stateId = recovery.stateId;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md border border-teal-300/25 px-3 text-sm text-teal-100 hover:bg-teal-300/10 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={isPending || !stateId}
          onClick={() =>
            stateId
              ? mutate(`/api/recovery-states/${stateId}/complete`, { exitCondition: "首页按钮完成恢复" })
              : undefined
          }
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          完成恢复
        </button>
        <button
          className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300/20 px-3 text-sm text-zinc-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={isPending || !stateId}
          onClick={() =>
            stateId
              ? mutate(`/api/recovery-states/${stateId}/cancel`, { exitCondition: "首页按钮取消恢复" })
              : undefined
          }
        >
          <XCircle className="h-4 w-4" aria-hidden="true" />
          取消恢复
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-red-200">{error}</p> : null}
    </div>
  );
}
