"use client";

import { ClipboardCheck } from "lucide-react";
import { useEffect } from "react";
import { CONFIRMATION_WINDOW_EVENT } from "@/components/global-confirmation-center";

export function ConfirmationWindowEntry(props: {
  filter: "pending" | "history";
  confirmationId?: string;
}) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(CONFIRMATION_WINDOW_EVENT, {
      detail: { filter: props.filter, confirmationId: props.confirmationId },
    }));
  }, [props.confirmationId, props.filter]);

  return (
    <section className="mx-auto flex min-h-[22rem] max-w-2xl flex-col items-center justify-center border-y border-white/10 px-6 py-12 text-center">
      <ClipboardCheck size={26} className="text-teal-200" aria-hidden="true" />
      <h1 className="mt-4 text-xl font-semibold text-white">确认中心窗口正在打开</h1>
      <p className="mt-2 text-sm leading-6 text-zinc-500">当前页面只作为深链入口，确认内容会在公共窗口中显示。</p>
    </section>
  );
}
