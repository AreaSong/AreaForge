"use client";

import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { readActionCenterToday } from "@/lib/api/action-center";
import type { ActionCenterTodayDto } from "@/lib/contracts";

export function ContinueNextAction(props: {
  fallbackHref?: string;
  fallbackLabel?: string;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "secondary";
}) {
  const [today, setToday] = useState<ActionCenterTodayDto | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void readActionCenterToday(controller.signal)
      .then((result) => setToday(result.ok ? result.body?.today ?? null : null))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setToday(null);
      });
    return () => controller.abort();
  }, []);

  const recommendation = today?.recommendation;
  const href = recommendation?.href ?? props.fallbackHref ?? "/today";
  const label = recommendation ? "继续下一项" : props.fallbackLabel ?? "回到今日";
  return (
    <ButtonLink href={decorateTodayReturn(href)} variant={props.variant ?? "primary"} size={props.size ?? "md"}>
      {label}
      <ArrowRight className="size-4" aria-hidden="true" />
    </ButtonLink>
  );
}

function decorateTodayReturn(href: string): string {
  if (!href.startsWith("/focus") && !href.startsWith("/knowledge/reviews/") && !href.startsWith("/roadmap/allocation/tasks/")) {
    return href;
  }
  const url = new URL(href, "http://areaforge.local");
  if (!url.searchParams.has("returnTo")) url.searchParams.set("returnTo", "/today");
  return `${url.pathname}${url.search}`;
}
