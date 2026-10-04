"use client";

import Link from "next/link";
import { useState } from "react";
import {
  BookOpen,
  CalendarCheck2,
  FileCheck2,
  Menu,
  Route,
  Settings,
  Timer,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { LogoutButton } from "@/components/logout-button";
import { Drawer } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { PRIMARY_WORKBENCH_ITEMS, UTILITY_NAV_ITEM } from "@/lib/navigation/app-navigation";

export function SharedMobileNavigation(props: { pathname: string; email: string; userId: string }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const utilityActive = UTILITY_NAV_ITEM.match(props.pathname);

  return (
    <>
      <nav
        className="af-mobile-primary-navigation af-shell-nav z-[var(--af-layer-shell-base)] shrink-0 overflow-hidden border-t border-white/10 bg-[#0d1117]/95 px-1 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] backdrop-blur"
        aria-label="移动导航"
        data-layout-region="mobile-primary-navigation"
      >
        <div className="mx-auto flex w-full min-w-0 items-center justify-center">
          {PRIMARY_WORKBENCH_ITEMS.map((item) => {
            const active = item.match(props.pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={navigationAriaCurrent(props.pathname, item)}
                title={item.label}
                className={`flex h-12 min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-1 rounded-md px-0.5 text-center text-[11px] whitespace-nowrap ${active ? "text-teal-300" : "text-zinc-400"}`}
              >
                <MobileNavigationIcon href={item.href} />
                <span className="max-[279px]:sr-only">{item.label}</span>
              </Link>
            );
          })}
          <Button
            variant="ghost"
            type="button"
            className={`!flex !h-12 !shrink min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-1 rounded-md px-0.5 text-center text-[11px] whitespace-nowrap ${utilityActive ? "text-teal-300" : "text-zinc-400"}`}
            onClick={() => setDrawerOpen(true)}
            aria-label="打开工具与设置"
            aria-expanded={drawerOpen}
          >
            <Menu className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="max-[279px]:sr-only">更多</span>
          </Button>
        </div>
      </nav>

      <Drawer open={drawerOpen} title="工具与设置" onClose={() => setDrawerOpen(false)}>
        <nav className="grid gap-1" aria-label="设置导航">
          {(UTILITY_NAV_ITEM.children ?? []).map((item) => {
            const active = item.match(props.pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={navigationAriaCurrent(props.pathname, item)}
                className={drawerLinkClass(active)}
                onClick={() => setDrawerOpen(false)}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-5 border-t border-white/10 pt-4">
          <p className="mb-3 truncate text-xs text-zinc-500">{props.email}</p>
          <LogoutButton userId={props.userId} />
        </div>
      </Drawer>
    </>
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

function drawerLinkClass(active: boolean): string {
  return `flex min-h-11 items-center gap-3 rounded-md px-3 text-sm ${active ? "bg-teal-300/10 text-teal-200" : "text-zinc-300 hover:bg-white/[0.05] hover:text-white"}`;
}

const MOBILE_NAVIGATION_ICONS: Record<string, LucideIcon> = {
  "/focus": Timer,
  "/today": CalendarCheck2,
  "/knowledge": BookOpen,
  "/test/retests": FileCheck2,
  "/roadmap": Route,
};
