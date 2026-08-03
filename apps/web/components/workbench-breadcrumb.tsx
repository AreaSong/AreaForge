"use client";

import { ChevronRight, Home } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { getNavigationTrail, sanitizeReturnPath } from "@/lib/navigation/batch7";
import { getSourceContextLabel } from "@/lib/navigation/return-context";

export function WorkbenchBreadcrumb({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnPath(searchParams.get("returnTo"));
  const hasReturnContext = Boolean(searchParams.get("returnTo")) && returnTo !== "/today";
  const trail = getNavigationTrail(pathname);

  return (
    <div className="mt-3 flex min-w-0 items-center justify-between gap-3 border-t border-white/10 pt-3" data-global-ai-ui="true">
      <nav className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-500" aria-label="面包屑">
        <Link href="/focus" className="inline-flex shrink-0 items-center gap-1 text-zinc-400 hover:text-white" title="返回开始学习">
          <Home size={14} aria-hidden="true" />
          <span className="sr-only">开始学习</span>
        </Link>
        {trail.map((item, index) => (
          <span key={`${item.href}:${item.label}`} className="flex min-w-0 items-center gap-1.5">
            <ChevronRight size={13} className="shrink-0 text-zinc-700" aria-hidden="true" />
            {index === trail.length - 1 ? (
              <span className="truncate text-zinc-200" data-ai-selectable data-ai-label={item.label}>{item.label}</span>
            ) : (
              <Link href={item.href} className="truncate text-zinc-400 hover:text-zinc-200">{item.label}</Link>
            )}
          </span>
        ))}
        {hasReturnContext ? (
          <>
            <ChevronRight size={13} className="shrink-0 text-zinc-700" aria-hidden="true" />
            <Link href={returnTo} className="truncate text-teal-300 hover:text-teal-200" title="返回来源页面">来源：{getSourceContextLabel(returnTo)}</Link>
          </>
        ) : null}
      </nav>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
