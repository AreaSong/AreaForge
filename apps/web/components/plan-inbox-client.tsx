"use client";

import { isConflict, isUnauthorized } from "@/lib/client/api-errors";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { planInboxOriginLabel } from "@/components/plan-inbox-origin";
import { Button, buttonClassName } from "@/components/ui/button";
import { transitionPlanInboxItem } from "@/lib/api/plan-inbox";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import { formatDate } from "@/lib/formatters";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import type { PlanInboxItemDto } from "@/lib/contracts";

type Status = "OPEN" | "DISMISSED" | "CONVERTED";
type TransitionAction = "dismiss" | "reopen";

interface PlanInboxListConflict {
  submitted: PlanInboxItemDto;
  latest: PlanInboxItemDto;
  action: TransitionAction;
  conflictFields: string[];
}

export function PlanInboxClient({ items: initialItems, status, returnTo = "/roadmap/allocation/drafts" }: { items: PlanInboxItemDto[]; status: Status; returnTo?: string }) {
  const router = useRouter();
  const sourceReturnTo = getSourceReturnTo(returnTo);
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState<string | null>(null);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PlanInboxListConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);

  async function transition(item: PlanInboxItemDto, action: TransitionAction) {
    if (pendingItemId) return;
    if (conflict) return setConflictOpen(true);
    setError(null);
    setPendingItemId(item.id);
    try {
      const result = await transitionPlanInboxItem(item.id, action, item.revision);
      const body = result.body;
      if (isUnauthorized(result)) {
        setError("登录已过期，当前状态没有改变。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (result.status === 404) {
        router.replace(returnTo);
        return;
      }
      if (!result.ok || !isPlanInboxItemDto(body?.item)) {
        setError(body?.error ?? "操作失败，当前状态没有改变；请显式重试。");
        if (isConflict(result) && isPlanInboxItemDto(body?.latest)) {
          setConflict({
            submitted: item,
            latest: body.latest,
            action,
            conflictFields: body.conflictFields ?? ["revision"],
          });
          setConflictOpen(true);
        }
        return;
      }
      const updatedItem = body.item;
      setItems((current) => replacePlanInboxListItem(current, item.id, updatedItem));
    } catch {
      setError("网络不可用，当前状态没有改变；恢复网络后请显式重试。");
    } finally {
      setPendingItemId(null);
    }
  }

  function adoptLatest(retryIntended: boolean): void {
    if (!conflict) return;
    setItems((current) => replacePlanInboxListItem(current, conflict.submitted.id, conflict.latest));
    setConflict(null);
    setConflictOpen(false);
    setError(retryIntended
      ? `已保留“${conflict.action === "dismiss" ? "忽略" : "恢复"}”意图并采用服务端 r${conflict.latest.revision}；请检查后显式再次点击。`
      : `已明确采用服务端 r${conflict.latest.revision}，没有自动执行任何状态变更。`);
  }

  return (
    <section className="space-y-4">
      <div><h1 className="text-2xl font-semibold text-white">投入草稿</h1><p className="mt-1 text-sm text-zinc-400">补全草稿后，由你确认转换为正式行动。</p></div>
      {sourceReturnTo ? <Link href={sourceReturnTo} className="inline-flex text-sm text-zinc-400 hover:text-zinc-200">返回当前草稿</Link> : null}
      <nav aria-label="收件箱状态" className="flex flex-wrap gap-2">
        {(["OPEN", "DISMISSED", "CONVERTED"] as const).map((value) => <Link key={value} href={withInboxStatus(returnTo, value)} aria-current={status === value ? "page" : undefined} className={`h-10 rounded-md border px-3 text-sm leading-10 ${status === value ? "border-teal-400/50 bg-teal-400/10 text-teal-200" : "border-white/10 text-zinc-300"}`}>{value === "OPEN" ? "待处理" : value === "DISMISSED" ? "已忽略" : "已转换"}</Link>)}
      </nav>
      {items.length === 0 ? (
        <div className="border-y border-white/10 py-6">
          <p className="text-sm text-zinc-400">{status === "OPEN" ? "当前没有待处理草稿。" : "此状态下没有项目。"}</p>
          <Link href={status === "OPEN" ? "/today" : withInboxStatus(returnTo, "OPEN")} className="mt-3 inline-flex h-10 items-center text-sm text-teal-300 hover:text-teal-200">
            {status === "OPEN" ? "回到今日，查看下一行动" : "返回待处理草稿"}
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-md border border-white/10 bg-[#101419] p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="font-medium text-white">{item.title || "未命名草稿"}</p><p className="mt-1 text-xs text-zinc-500">{planInboxOriginLabel(item.originType)} · {formatDate(item.updatedAt)}</p></div>
                <span className={`rounded-sm px-2 py-1 text-xs ${item.missingFields.length ? "bg-amber-400/10 text-amber-200" : "bg-emerald-400/10 text-emerald-200"}`}>{item.missingFields.length ? `缺 ${item.missingFields.length} 项` : "字段完整"}</span>
              </div>
              {item.supersededByItemId ? <p className="mt-2 text-xs text-amber-200">此版本已被替代，只能查看历史。</p> : null}
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                {item.status === "OPEN" && !item.supersededByItemId ? (
                  <Link href={withReturnTo(`/roadmap/allocation/drafts/${item.id}`, returnTo)} className={buttonClassName({ variant: "primary", size: "sm" })}>
                    {item.missingFields.length ? "补全并转换" : "确认并转换"}
                  </Link>
                ) : null}
                {item.status === "OPEN" && !item.supersededByItemId ? <Button type="button" disabled={Boolean(pendingItemId)} variant="ghost" size="sm" onClick={() => void transition(item, "dismiss")}>忽略</Button> : null}
                {item.status === "DISMISSED" && !item.supersededByItemId ? <Button type="button" disabled={Boolean(pendingItemId)} variant="secondary" size="sm" onClick={() => void transition(item, "reopen")}>恢复草稿</Button> : null}
                {item.convertedTaskId ? <Link href={withReturnTo(`/roadmap/allocation/tasks/${item.convertedTaskId}`, returnTo)} className={buttonClassName({ variant: "primary", size: "sm" })}>打开任务</Link> : null}
                {item.status !== "OPEN" || item.supersededByItemId ? <Link href={withReturnTo(`/roadmap/allocation/drafts/${item.id}`, returnTo)} className={buttonClassName({ variant: "ghost", size: "sm" })}>查看记录</Link> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
      {conflict && !conflictOpen ? <Button type="button" variant="ghost" size="sm" className="!h-auto !border-0 !p-0 text-sm text-amber-200 underline" onClick={() => setConflictOpen(true)}>处理收件箱状态冲突</Button> : null}
      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="处理收件箱状态冲突"
        description="项目已在其他页面或设备更新。本次动作没有执行，系统不会自动采用或重放。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={conflict ? [
          { field: "revision", label: "Inbox revision", local: conflict.submitted.revision, server: conflict.latest.revision },
          { field: "status", label: "状态", local: conflict.submitted.status, server: conflict.latest.status },
          { field: "originVersion", label: "来源版本", local: conflict.submitted.originVersion, server: conflict.latest.originVersion },
          { field: "supersededByItemId", label: "替代项目", local: conflict.submitted.supersededByItemId, server: conflict.latest.supersededByItemId },
          { field: "convertedTaskId", label: "转换任务", local: conflict.submitted.convertedTaskId, server: conflict.latest.convertedTaskId },
        ] : []}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={() => adoptLatest(false)}
        onManualMerge={() => adoptLatest(true)}
        mergeLabel="保留动作意图并人工处理"
      />
    </section>
  );
}

function withInboxStatus(returnTo: string, status: Status): string {
  try {
    const url = new URL(returnTo, "https://areaforge.invalid");
    if (url.pathname !== "/roadmap/allocation/drafts") return `/roadmap/allocation/drafts?status=${status}`;
    url.searchParams.set("status", status);
    return `${url.pathname}?${url.searchParams.toString()}`;
  } catch {
    return `/roadmap/allocation/drafts?status=${status}`;
  }
}

function getSourceReturnTo(returnTo: string): string | null {
  try {
    const source = new URL(returnTo, "https://areaforge.invalid").searchParams.get("returnTo");
    return source && source.startsWith("/") && !source.startsWith("//") ? source : null;
  } catch {
    return null;
  }
}

function replacePlanInboxListItem(items: PlanInboxItemDto[], previousId: string, latest: PlanInboxItemDto): PlanInboxItemDto[] {
  const replaced = items.map((item) => item.id === previousId ? latest : item);
  return replaced.filter((item, index) => replaced.findIndex((candidate) => candidate.id === item.id) === index);
}

function isPlanInboxItemDto(value: unknown): value is PlanInboxItemDto {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PlanInboxItemDto>;
  return typeof item.id === "string"
    && typeof item.workspaceId === "string"
    && typeof item.originKey === "string"
    && typeof item.originVersion === "number"
    && (item.status === "OPEN" || item.status === "DISMISSED" || item.status === "CONVERTED")
    && typeof item.revision === "number"
    && Array.isArray(item.dependencyRefs);
}
