"use client";

import type { ReactNode } from "react";
import { DetailHeading } from "@/components/detail-heading";
import { BackToListLink } from "@/components/list-return-context";
import { getReturnContextLabel } from "@/lib/navigation/return-context";

export function KnowledgeObjectDetailHeader(props: {
  fallbackHref: string;
  fallbackLabel: string;
  returnTo?: string;
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  const backHref = props.returnTo ?? props.fallbackHref;
  return (
    <header className="border-b border-white/10 pb-5">
      <BackToListLink className="text-sm text-teal-300 hover:underline" fallbackHref={backHref}>
        {getReturnContextLabel(props.returnTo, props.fallbackLabel)}
      </BackToListLink>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-zinc-500">{props.eyebrow}</p>
          <DetailHeading className="mt-1 break-words text-2xl font-semibold text-white">{props.title}</DetailHeading>
          {props.description ? <div className="mt-2 text-sm leading-6 text-zinc-400">{props.description}</div> : null}
        </div>
        {props.actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{props.actions}</div> : null}
      </div>
    </header>
  );
}
