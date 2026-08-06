"use client";

import Link from "next/link";
import {
  BookOpen,
  CalendarCheck2,
  FileCheck2,
  Route,
  Settings,
  Timer,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PRIMARY_WORKBENCH_ITEMS, UTILITY_NAV_ITEM } from "@/lib/navigation/batch7";

export function SharedMobileNavigation({ pathname }: { pathname: string }) {
  return (
    <nav
      className="af-shell-nav z-20 shrink-0 overflow-x-auto border-t border-white/10 bg-[#0d1117]/95 px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden"
      aria-label="移动导航"
    >
      <div className="mx-auto grid w-full max-w-lg grid-cols-6 items-center">
        {[...PRIMARY_WORKBENCH_ITEMS, UTILITY_NAV_ITEM].map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={navigationAriaCurrent(pathname, item)}
              title={item.label}
              className={`flex min-h-11 min-w-0 flex-col items-center gap-1 rounded-md px-1 py-2 text-center text-xs ${active ? "text-teal-300" : "text-zinc-400"}`}
            >
              <MobileNavigationIcon href={item.href} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function navigationAriaCurrent(pathname: string, item: { href: string; match: (path: string) => boolean }): "page" | "location" | undefined {
  if (!item.match(pathname)) return undefined;
  return pathname === item.href ? "page" : "location";
}

function MobileNavigationIcon({ href }: { href: string }) {
  const Icon = MOBILE_NAVIGATION_ICONS[href] ?? Settings;
  return <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />;
}

const MOBILE_NAVIGATION_ICONS: Record<string, LucideIcon> = {
  "/focus": Timer,
  "/today": CalendarCheck2,
  "/knowledge": BookOpen,
  "/test/retests": FileCheck2,
  "/roadmap": Route,
  "/settings/exams": Settings,
};
