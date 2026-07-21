"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function StageDraftActions({ draftId }: { draftId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deciding, setDeciding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "confirm" | "reject") {
    if (deciding) return;
    if (action === "reject" && !window.confirm("拒绝后当前阶段草稿进入不可逆终态。确认拒绝？")) return;
    setError(null);
    setDeciding(true);
    try {
      const response = await fetch(`/api/simulation/stage-adjustment-drafts/${draftId}/${action}`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) { setError(body?.error ?? "阶段决策失败"); return; }
      setNotice(action === "confirm" ? "阶段计划已更新，全部草稿已原子入箱；现有任务未被修改。" : "阶段草稿已不可逆拒绝。");
      startTransition(() => router.refresh());
    } finally {
      setDeciding(false);
    }
  }

  return <div className="mt-4"><div className="flex flex-wrap gap-2"><button disabled={pending || deciding} onClick={() => void decide("confirm")} className="h-10 rounded-md bg-teal-500 px-3 text-sm font-medium text-black disabled:opacity-60">确认阶段调整</button><button disabled={pending || deciding} onClick={() => void decide("reject")} className="h-10 rounded-md border border-red-300/30 px-3 text-sm text-red-200 disabled:opacity-60">拒绝</button><Link href="/today/inbox" className="h-10 px-2 text-sm leading-10 text-teal-300">查看收件箱</Link></div>{notice ? <p role="status" className="mt-2 text-sm text-teal-200">{notice}</p> : null}{error ? <p role="alert" className="mt-2 text-sm text-red-300">{error}</p> : null}</div>;
}
