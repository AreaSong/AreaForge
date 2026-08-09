"use client";

import { ClipboardCheck } from "lucide-react";

export function ConfirmationWindowEntry(props: {
  filter: "pending" | "history";
  confirmationId?: string;
}) {
  const destination = props.confirmationId
    ? "确认事项"
    : props.filter === "history"
      ? "确认记录"
      : "确认中心";

  return (
    <section className="mx-auto flex min-h-[22rem] max-w-2xl flex-col items-center justify-center border-y border-white/10 px-6 py-12 text-center">
      <ClipboardCheck size={26} className="text-teal-200" aria-hidden="true" />
      <h1 className="mt-4 text-xl font-semibold text-white">确认中心窗口正在打开</h1>
      <p className="mt-2 text-sm leading-6 text-zinc-500">当前页面是{destination}的深链入口，内容会在公共窗口中显示。</p>
    </section>
  );
}
