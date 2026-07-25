"use client";

import Link from "next/link";
import { useState } from "react";
import type { PlanInboxItemDto } from "@/lib/study/plan-inbox-service";

type Status = "OPEN" | "DISMISSED" | "CONVERTED";

export function PlanInboxClient({ items: initialItems, status }: { items: PlanInboxItemDto[]; status: Status }) {
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState<string | null>(null);

  async function transition(item: PlanInboxItemDto, action: "dismiss" | "reopen") {
    setError(null);
    const response = await fetch(`/api/plan-inbox/${item.id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: item.revision }),
    });
    const body = await response.json().catch(() => null) as { item?: PlanInboxItemDto; error?: string; latest?: PlanInboxItemDto } | null;
    if (!response.ok || !body?.item) {
      setError(body?.error ?? "操作失败");
      if (body?.latest) setItems((current) => current.map((row) => row.id === item.id ? body.latest as PlanInboxItemDto : row));
      return;
    }
    setItems((current) => current.map((row) => row.id === item.id ? body.item as PlanInboxItemDto : row));
  }

  return (
    <section className="space-y-4">
      <div><h1 className="text-2xl font-semibold text-white">计划收件箱</h1><p className="mt-1 text-sm text-zinc-400">补全草稿后，由你确认转换为正式任务。</p></div>
      <nav aria-label="收件箱状态" className="flex flex-wrap gap-2">
        {(["OPEN", "DISMISSED", "CONVERTED"] as const).map((value) => <Link key={value} href={`/today/inbox?status=${value}`} aria-current={status === value ? "page" : undefined} className={`h-10 rounded-md border px-3 text-sm leading-10 ${status === value ? "border-teal-400/50 bg-teal-400/10 text-teal-200" : "border-white/10 text-zinc-300"}`}>{value === "OPEN" ? "待处理" : value === "DISMISSED" ? "已忽略" : "已转换"}</Link>)}
      </nav>
      {items.length === 0 ? <p className="text-sm text-zinc-500">此状态下没有项目。</p> : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-md border border-white/10 bg-[#101419] p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><Link href={`/today/inbox/${item.id}`} className="font-medium text-white hover:text-teal-300">{item.title || "未命名草稿"}</Link><p className="mt-1 text-xs text-zinc-500">{item.originType} · v{item.originVersion} · rev {item.revision}</p></div>
                <span className={`rounded-sm px-2 py-1 text-xs ${item.missingFields.length ? "bg-amber-400/10 text-amber-200" : "bg-emerald-400/10 text-emerald-200"}`}>{item.missingFields.length ? `缺 ${item.missingFields.length} 项` : "字段完整"}</span>
              </div>
              {item.supersededByItemId ? <p className="mt-2 text-xs text-amber-200">此版本已被替代，只能查看历史。</p> : null}
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                <Link href={`/today/inbox/${item.id}`} className="text-teal-300 hover:underline">查看与转换</Link>
                {item.status === "OPEN" && !item.supersededByItemId ? <button type="button" className="text-zinc-400 hover:text-white" onClick={() => void transition(item, "dismiss")}>忽略</button> : null}
                {item.status === "DISMISSED" && !item.supersededByItemId ? <button type="button" className="text-teal-300 hover:underline" onClick={() => void transition(item, "reopen")}>{status === "OPEN" ? "Undo" : "恢复"}</button> : null}
                {item.convertedTaskId ? <Link href={`/today/tasks/${item.convertedTaskId}`} className="text-teal-300 hover:underline">打开任务</Link> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
    </section>
  );
}
