"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export interface WorkbenchNavigationItem {
  href: string;
  label: string;
  icon?: ReactNode;
}

export function WorkbenchNavigation(props: {
  label: string;
  items: readonly WorkbenchNavigationItem[];
  tools?: readonly WorkbenchNavigationItem[];
  suffix?: string;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
      <nav className="flex min-w-0 gap-1 overflow-x-auto pb-1" aria-label={props.label}>
        {props.items.map((item) => <NavigationLink key={item.href} item={item} pathname={pathname} suffix={props.suffix} />)}
      </nav>
      {props.tools?.length ? (
        <nav className="flex shrink-0 items-center gap-1 border-t border-white/10 pt-2 lg:border-l lg:border-t-0 lg:pl-3 lg:pt-0" aria-label={`${props.label}工具`}>
          <span className="mr-1 text-xs text-zinc-600">工具</span>
          {props.tools.map((item) => <NavigationLink key={item.href} item={item} pathname={pathname} suffix={props.suffix} compact />)}
        </nav>
      ) : null}
    </div>
  );
}

function NavigationLink(props: {
  item: WorkbenchNavigationItem;
  pathname: string;
  suffix?: string;
  compact?: boolean;
}) {
  const active = props.pathname === props.item.href || props.pathname.startsWith(`${props.item.href}/`);
  return (
    <Link
      href={`${props.item.href}${props.suffix ?? ""}`}
      aria-current={active ? "page" : undefined}
      className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md px-3 text-sm transition-colors ${active
        ? "bg-white/10 text-white"
        : props.compact
          ? "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100"
          : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100"
      }`}
    >
      {props.item.icon}
      {props.item.label}
    </Link>
  );
}
