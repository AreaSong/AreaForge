"use client";

import { isConflict, isUnauthorized } from "@/lib/client/api-errors";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { planInboxOriginLabel } from "@/components/plan-inbox-origin";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
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
    <section className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">投入草稿</h1>
          <p className="mt-1 text-sm text-zinc-400">补全草稿后，由你确认转换为正式行动。</p>
        </div>
        {sourceReturnTo ? <Link href={sourceReturnTo} className="inline-flex text-sm text-teal-300 hover:underline">返回当前草稿</Link> : null}
      </div>

      <nav aria-label="收件箱状态" className="flex flex-wrap gap-2">
        {(["OPEN", "DISMISSED", "CONVERTED"] as const).map((value) => (
          <Link
            key={value}
            href={withInboxStatus(returnTo, value)}
            aria-current={status === value ? "page" : undefined}
            className={`h-10 rounded-xl border px-4 text-xs font-medium leading-10 transition-all ${
              status === value
                ? "border-teal-500/30 bg-teal-400/10 text-teal-200 shadow-[0_0_12px_rgba(45,212,191,0.15)]"
                : "border-white/5 bg-white/[0.02] text-zinc-400 hover:border-white/10 hover:text-white"
            }`}
          >
            {value === "OPEN" ? "待处理" : value === "DISMISSED" ? "已忽略" : "已转换"}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <Card variant="subtle" className="p-8 text-center space-y-3">
          <p className="text-sm text-zinc-400">{status === "OPEN" ? "当前没有待处理草稿。" : "此状态下没有项目。"}</p>
          <div>
            <ButtonLink
              href={status === "OPEN" ? "/today" : withInboxStatus(returnTo, "OPEN")}
              variant="secondary"
              size="sm"
            >
              {status === "OPEN" ? "回到今日，查看下一行动" : "返回待处理草稿"}
            </ButtonLink>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((item) => (
            <Card key={item.id} variant="master" className="flex flex-col justify-between p-5 space-y-4">
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-xs font-medium text-teal-300">
                    {planInboxOriginLabel(item.originType)}
                  </span>
                  <Badge tone={item.missingFields.length ? "warning" : "success"}>
                    {item.missingFields.length ? `缺 ${item.missingFields.length} 项` : "字段完整"}
                  </Badge>
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white break-words">
                    {item.title || "未命名草稿"}
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500">{formatDate(item.updatedAt)}</p>
                </div>
                {item.supersededByItemId ? (
                  <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-2 text-xs text-amber-200">
                    此版本已被替代，只能查看历史。
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-white/5">
                {item.status === "OPEN" && !item.supersededByItemId ? (
                  <ButtonLink
                    href={withReturnTo(`/roadmap/allocation/drafts/${item.id}`, returnTo)}
                    variant="primary"
                    size="sm"
                  >
                    {item.missingFields.length ? "补全并转换" : "确认并转换"}
                  </ButtonLink>
                ) : null}
                {item.status === "OPEN" && !item.supersededByItemId ? (
                  <Button
                    type="button"
                    disabled={Boolean(pendingItemId)}
                    variant="ghost"
                    size="sm"
                    onClick={() => void transition(item, "dismiss")}
                  >
                    忽略
                  </Button>
                ) : null}
                {item.status === "DISMISSED" && !item.supersededByItemId ? (
                  <Button
                    type="button"
                    disabled={Boolean(pendingItemId)}
                    variant="secondary"
                    size="sm"
                    onClick={() => void transition(item, "reopen")}
                  >
                    恢复草稿
                  </Button>
                ) : null}
                {item.convertedTaskId ? (
                  <ButtonLink
                    href={withReturnTo(`/roadmap/allocation/tasks/${item.convertedTaskId}`, returnTo)}
                    variant="primary"
                    size="sm"
                  >
                    打开任务
                  </ButtonLink>
                ) : null}
                {item.status !== "OPEN" || item.supersededByItemId ? (
                  <ButtonLink
                    href={withReturnTo(`/roadmap/allocation/drafts/${item.id}`, returnTo)}
                    variant="ghost"
                    size="sm"
                  >
                    查看记录
                  </ButtonLink>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
      {conflict && !conflictOpen ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="!h-auto !border-0 !p-0 text-sm text-amber-200 underline"
          onClick={() => setConflictOpen(true)}
        >
          处理收件箱状态冲突
        </Button>
      ) : null}

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
