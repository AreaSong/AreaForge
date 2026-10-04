"use client";

import Link from "next/link";
import {
  BarChart3,
  BookOpen,
  CalendarCheck2,
  FileCheck2,
  Inbox,
  LayoutDashboard,
  ListTree,
  Menu,
  Route,
  Settings,
  Timer,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Drawer } from "@/components/ui/overlays";
import { APP_NAVIGATION_ITEMS, UTILITY_NAV_ITEM } from "@/lib/navigation/app-navigation";
import type { AppNavigationItem } from "@/lib/navigation/app-navigation";

const icons: Record<string, LucideIcon> = {
  "/focus": Timer,
  "/today": CalendarCheck2,
  "/knowledge": BookOpen,
  "/test/retests": FileCheck2,
  "/roadmap": Route,
  "/settings/exams": Settings,
  "/knowledge/points": LayoutDashboard,
  "/knowledge/syllabi": ListTree,
  "/roadmap/allocation": Inbox,
  "/roadmap/reviews": BarChart3,
};

export function TabletNavigationDrawer(props: {
  open: boolean;
  pathname: string;
  email: string;
  userId: string;
  onClose: () => void;
}) {
  const activeWorkbench = APP_NAVIGATION_ITEMS.find((item) => item.match(props.pathname));
  return (
    <Drawer open={props.open} title="AreaForge 导航" side="left" onClose={props.onClose}>
      <div className="space-y-5">
        <nav className="grid gap-1" aria-label="一级导航">
          {APP_NAVIGATION_ITEMS.map((item) => (
            <NavigationLink key={item.href} item={item} pathname={props.pathname} onNavigate={props.onClose} />
          ))}
        </nav>
        {activeWorkbench?.children?.length ? (
          <section className="border-t border-white/10 pt-4" aria-labelledby="tablet-secondary-heading">
            <h3 id="tablet-secondary-heading" className="mb-2 px-3 text-xs font-medium text-zinc-500">{activeWorkbench.label}内容</h3>
            <nav className="grid gap-1" aria-label={`${activeWorkbench.label}二级导航`}>
              {activeWorkbench.children.map((item) => (
                <NavigationLink key={item.href} item={item} pathname={props.pathname} onNavigate={props.onClose} secondary />
              ))}
            </nav>
          </section>
        ) : null}
        <section className="border-t border-white/10 pt-4" aria-labelledby="tablet-utility-heading">
          <h3 id="tablet-utility-heading" className="mb-2 px-3 text-xs font-medium text-zinc-500">工具与设置</h3>
          <nav className="grid gap-1" aria-label="工具与设置">
            {(UTILITY_NAV_ITEM.children ?? []).map((item) => (
              <NavigationLink key={item.href} item={item} pathname={props.pathname} onNavigate={props.onClose} secondary />
            ))}
          </nav>
          <p className="mt-4 truncate px-3 text-xs text-zinc-500">{props.email}</p>
        </section>
      </div>
    </Drawer>
  );
}

function NavigationLink(props: {
  item: AppNavigationItem;
  pathname: string;
  onNavigate: () => void;
  secondary?: boolean;
}) {
  const active = props.item.match(props.pathname);
  const Icon = icons[props.item.href] ?? Menu;
  return (
    <Link
      href={props.item.href}
      onClick={props.onNavigate}
      aria-current={active ? (props.pathname === props.item.href ? "page" : "location") : undefined}
      className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-sm ${active ? "bg-teal-300/10 text-teal-200" : props.secondary ? "text-zinc-300 hover:bg-white/[0.05] hover:text-white" : "text-zinc-200 hover:bg-white/[0.05] hover:text-white"}`}
    >
      <Icon size={16} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{props.item.label}</span>
    </Link>
  );
}
