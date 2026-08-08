"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { getNavigationTrail, sanitizeReturnPath } from "@/lib/navigation/batch7";
import { getSourceContextLabel } from "@/lib/navigation/return-context";

/** Stable page-level action region. It remains mounted even when a page has no actions yet. */
export function PageToolbar({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnPath(searchParams.get("returnTo"));
  const hasReturnContext = Boolean(searchParams.get("returnTo")) && returnTo !== "/today";
  const trail = getNavigationTrail(pathname);

  return (
    <div
      className="mt-3 flex min-h-12 min-w-0 flex-wrap items-center gap-3 border-t border-white/10 px-4 pt-3 sm:flex-nowrap sm:px-6 xl:px-8"
      data-layout-region="page-toolbar"
      data-global-ai-ui="true"
    >
      <nav className="flex min-h-9 min-w-0 flex-[1_1_14rem] items-center gap-1.5 text-xs text-zinc-500" aria-label="面包屑">
        {trail.map((item, index) => (
          <span key={`${item.href}:${item.label}`} className="flex min-w-0 items-center gap-1.5">
            {index > 0 ? <ChevronRight size={13} className="shrink-0 text-zinc-700" aria-hidden="true" /> : null}
            {index === trail.length - 1 ? (
              <span className="truncate text-zinc-200" data-ai-selectable data-ai-label={item.label}>{item.label}</span>
            ) : (
              <Link href={item.href} className="truncate text-zinc-400 hover:text-zinc-200">{item.label}</Link>
            )}
          </span>
        ))}
        {hasReturnContext ? (
          <>
            {trail.length > 0 ? <ChevronRight size={13} className="shrink-0 text-zinc-700" aria-hidden="true" /> : null}
            <Link href={returnTo} className="truncate text-teal-300 hover:text-teal-200" title="返回来源页面">来源：{getSourceContextLabel(returnTo)}</Link>
          </>
        ) : null}
      </nav>
      <div className="flex min-h-9 min-w-0 basis-full flex-1 flex-wrap items-center justify-end gap-1.5 sm:basis-auto sm:max-w-[68%]" data-page-actions="true">
        {children}
      </div>
    </div>
  );
}
