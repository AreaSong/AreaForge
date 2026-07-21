"use client";

import Link from "next/link";
import type { PlanInboxItemDto } from "@/lib/study/plan-inbox-service";

export function PlanInboxClient({ items }: { items: PlanInboxItemDto[] }) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold text-white">计划收件箱</h1>
      <p className="text-sm text-zinc-400">OPEN 草稿、完整度与转换入口</p>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">当前没有 OPEN 草稿。</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-md border border-white/10 bg-[#101419] p-3">
              <Link href={`/today/inbox/${item.id}`} className="font-medium text-white hover:text-teal-300">
                {item.title}
              </Link>
              <p className="mt-1 text-xs text-zinc-500">
                {item.status} · rev {item.revision}
                {item.convertedTaskId ? ` · 已转换` : ""}
                {item.supersededByItemId ? ` · 已被 supersede` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
