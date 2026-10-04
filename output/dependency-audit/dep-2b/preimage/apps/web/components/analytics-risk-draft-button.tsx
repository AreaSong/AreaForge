"use client";

import { Inbox } from "lucide-react";
import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { addAnalyticsRiskToInbox } from "@/lib/api/plan-inbox";
import { classifyApiFailure } from "@/lib/client/api-errors";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import type { AnalyticsRiskItemDto } from "@/lib/contracts";

export function AnalyticsRiskDraftButton(props: {
  risk: Pick<AnalyticsRiskItemDto, "id" | "type">;
  windowDays: 7 | 30;
  size?: "sm" | "md" | "lg";
}) {
  const [created, setCreated] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createDraft() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await addAnalyticsRiskToInbox({
        riskId: props.risk.id,
        riskType: props.risk.type,
        windowDays: props.windowDays,
      });
      if (result.ok && result.body?.item) {
        setCreated(true);
        return;
      }
      const failure = classifyApiFailure(result);
      if (failure.kind === "unauthorized") return redirectToLoginWithCurrentLocation();
      setError(failure.kind === "conflict"
        ? "风险状态已变化，请刷新趋势后再决定。"
        : "暂时无法加入投入草稿，请稍后重试。");
    } catch {
      setError("网络不可用，风险行动尚未保存。");
    } finally {
      setPending(false);
    }
  }

  if (created) {
    return (
      <ButtonLink href="/roadmap/allocation/drafts" variant="secondary" size={props.size ?? "sm"}>
        <Inbox className="size-4" aria-hidden="true" />
        查看投入草稿
      </ButtonLink>
    );
  }

  return (
    <div className="min-w-0">
      <Button
        type="button"
        variant="secondary"
        size={props.size ?? "sm"}
        loading={pending}
        loadingLabel="正在加入..."
        onClick={() => void createDraft()}
      >
        <Inbox className="size-4" aria-hidden="true" />
        加入投入草稿
      </Button>
      {error ? <p className="mt-1 max-w-56 text-xs leading-5 text-rose-300" role="alert">{error}</p> : null}
    </div>
  );
}
