"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface StageDraftCreateActionProps {
  stagePlanId: string;
  label?: string;
}

export function StageDraftCreateAction({ stagePlanId, label = "生成阶段草稿" }: StageDraftCreateActionProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createDraft() {
    if (creating) return;
    setError(null);
    setCreating(true);
    try {
      const response = await fetch("/api/stage-adjustment-drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stagePlanId }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? "生成阶段草稿失败");
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={pending || creating}
        onClick={() => void createDraft()}
        className="h-10 rounded-md border border-teal-300/30 px-3 text-sm text-teal-200 disabled:opacity-60"
      >
        {creating ? "生成中..." : label}
      </button>
      {error ? <p role="alert" className="mt-2 text-sm text-red-300">{error}</p> : null}
    </div>
  );
}

export function StageDraftActions({ draftId, revision }: { draftId: string; revision: number }) {
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
      const response = await fetch(`/api/stage-adjustment-drafts/${draftId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: revision }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string; draft?: { revision?: number }; inboxResult?: { createdCount: number; reusedCount: number; supersededCount: number }; latest?: { revision?: number }; conflictFields?: string[] } | null;
      if (!response.ok) {
        const suffix = response.status === 409 && body?.latest ? `（本地 revision=${revision}，服务端 revision=${body.latest.revision ?? "未知"}；字段=${body.conflictFields?.join("、") ?? "revision"}）` : "";
        setError(`${body?.error ?? "阶段决策失败"}${suffix}`);
        return;
      }
      const inbox = body?.inboxResult;
      const counts = inbox ? `入箱新增 ${inbox.createdCount}，复用 ${inbox.reusedCount}，替代 ${inbox.supersededCount}` : "";
      setNotice(action === "confirm" ? `阶段计划已更新，${counts}；现有任务未被修改。` : "阶段草稿已不可逆拒绝。");
      startTransition(() => router.refresh());
    } finally {
      setDeciding(false);
    }
  }

  return <div className="mt-4"><div className="flex flex-wrap gap-2"><button disabled={pending || deciding} onClick={() => void decide("confirm")} className="h-10 rounded-md bg-teal-500 px-3 text-sm font-medium text-black disabled:opacity-60">确认阶段调整</button><button disabled={pending || deciding} onClick={() => void decide("reject")} className="h-10 rounded-md border border-red-300/30 px-3 text-sm text-red-200 disabled:opacity-60">拒绝</button><Link href="/today/inbox" className="h-10 px-2 text-sm leading-10 text-teal-300">查看收件箱</Link></div>{notice ? <p role="status" className="mt-2 text-sm text-teal-200">{notice}</p> : null}{error ? <p role="alert" className="mt-2 text-sm text-red-300">{error}</p> : null}</div>;
}
