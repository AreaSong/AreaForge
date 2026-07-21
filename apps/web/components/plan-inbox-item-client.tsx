"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PlanInboxItemDto } from "@/lib/study/plan-inbox-service";

export function PlanInboxItemClient({ item }: { item: PlanInboxItemDto }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [convertedTaskId, setConvertedTaskId] = useState(item.convertedTaskId);

  async function convert() {
    setError(null);
    const response = await fetch(`/api/plan-inbox/${item.id}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: item.revision,
      }),
    });
    const body = (await response.json().catch(() => null)) as
      | { item?: PlanInboxItemDto; error?: string }
      | null;
    if (!response.ok) {
      setError(body?.error ?? "转换失败");
      return;
    }
    const taskId = body?.item?.convertedTaskId ?? null;
    setConvertedTaskId(taskId);
    router.refresh();
  }

  return (
    <section className="space-y-4">
      <Link href="/today/inbox" className="text-sm text-zinc-400 hover:text-zinc-200">
        返回收件箱
      </Link>
      <h1 className="text-3xl font-semibold text-white">{item.title}</h1>
      <p className="text-sm text-zinc-400">
        来源 {item.originType} · {item.originKey}@{item.originVersion}
      </p>
      <p className="text-sm text-zinc-500">
        状态 {item.status} · 计划日 {item.plannedDate ?? "未定"} · 预计 {item.estimatedMinutes ?? "—"} 分
      </p>
      {item.supersededByItemId ? (
        <p className="text-sm text-amber-200">
          已被新版本取代。
          <Link href={`/today/inbox/${item.supersededByItemId}`} className="ml-2 text-teal-300 hover:underline">
            查看最新
          </Link>
        </p>
      ) : null}
      {convertedTaskId ? (
        <Link href={`/today/tasks/${convertedTaskId}`} className="inline-flex text-teal-300 hover:underline">
          打开任务
        </Link>
      ) : (
        <button type="button" className="h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black" onClick={() => void convert()}>
          转换为任务
        </button>
      )}
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </section>
  );
}
