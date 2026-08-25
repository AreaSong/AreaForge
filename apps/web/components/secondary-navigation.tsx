"use client";

import Link from "next/link";
import {
  BarChart3,
  BriefcaseBusiness,
  ClipboardCheck,
  FilePlus2,
  Goal,
  Inbox,
  LayoutDashboard,
  ListTree,
  ListTodo,
  Milestone,
  MonitorCog,
  NotebookPen,
  PanelRightClose,
  PanelRightOpen,
  Repeat2,
  ScrollText,
  Settings,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AppNavigationItem } from "@/lib/navigation/app-navigation";
import { IconButton } from "@/components/ui/button";

export function SecondaryNavigation(props: {
  pathname: string;
  workbench: AppNavigationItem;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <aside
      aria-label={`${props.workbench.label}二级导航`}
      data-navigation-level="secondary"
      data-layout-region="secondary-navigation"
      className={`af-secondary-navigation-rail hidden min-h-0 shrink-0 flex-col border-r border-l border-r-white/[0.07] border-l-black/40 shadow-[-4px_0_12px_rgba(0,0,0,0.3)_inset] bg-[var(--af-surface-subtle)]/45 py-5 transition-[width] min-[1440px]:flex ${props.collapsed ? "w-[52px] px-1.5" : "w-[216px] px-3"}`}
    >
      <div className={`mb-5 flex items-center ${props.collapsed ? "justify-center" : "justify-between gap-2 px-2"}`}>
        <div className={props.collapsed ? "sr-only" : "min-w-0 border-l-2 border-teal-300/40 pl-2 text-xs font-medium text-zinc-500"}>
          <span className="truncate">{props.workbench.label}内容</span>
        </div>
        <IconButton
          label={props.collapsed ? "展开二级导航" : "收起二级导航"}
          type="button"
          size="sm"
          className="inline-flex !size-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
          onClick={props.onToggle}
          title={props.collapsed ? "展开二级导航" : "收起二级导航"}
          aria-expanded={!props.collapsed}
          aria-controls="secondary-navigation"
        >
          {props.collapsed ? <PanelRightOpen size={16} aria-hidden="true" /> : <PanelRightClose size={16} aria-hidden="true" />}
        </IconButton>
      </div>
      <nav id="secondary-navigation" className="min-h-0 overflow-y-auto" aria-label={`${props.workbench.label}业务导航`}>
        <div className="flex flex-col gap-1">
          {(props.workbench.children ?? []).map((child) => {
            const active = child.match(props.pathname);
            return (
              <Link
                key={child.href}
                href={child.href}
                aria-current={navigationAriaCurrent(props.pathname, child)}
                title={props.collapsed ? child.label : undefined}
                className={`group flex min-w-0 items-center rounded-md border-l-2 py-2.5 text-sm transition-all duration-300 ease-out ${props.collapsed ? "justify-center px-2" : "gap-2.5 px-3"} ${active ? "border-teal-300 shadow-[-2px_0_8px_rgba(45,212,191,0.15)] bg-gradient-to-r from-teal-400/[0.06] to-transparent text-teal-200" : "border-transparent text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"}`}
              >
                <SecondaryNavigationIcon href={child.href} />
                <span className={props.collapsed ? "sr-only" : "truncate"}>{child.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}

function navigationAriaCurrent(pathname: string, item: { href: string; match: (path: string) => boolean }): "page" | "location" | undefined {
  if (!item.match(pathname)) return undefined;
  return pathname === item.href ? "page" : "location";
}

function SecondaryNavigationIcon({ href }: { href: string }) {
  const Icon = SECONDARY_NAVIGATION_ICONS[href] ?? Settings;
  return <Icon className="h-4 w-4 shrink-0 transition-transform duration-300 group-hover:scale-110 group-active:scale-95" aria-hidden="true" />;
}

const SECONDARY_NAVIGATION_ICONS: Record<string, LucideIcon> = {
  "/roadmap": Goal,
  "/roadmap/allocation": Inbox,
  "/roadmap/stages": Milestone,
  "/roadmap/reviews": BarChart3,
  "/knowledge": LayoutDashboard,
  "/knowledge/points": ListTodo,
  "/knowledge/syllabi": ListTree,
  "/knowledge/resources": FilePlus2,
  "/knowledge/cards": NotebookPen,
  "/knowledge/mistakes": TriangleAlert,
  "/knowledge/reviews": ClipboardCheck,
  "/test/retests": Repeat2,
  "/test/simulations": ScrollText,
  "/settings": LayoutDashboard,
  "/settings/exams": BriefcaseBusiness,
  "/settings/profile": UserRound,
  "/settings/learning": SlidersHorizontal,
  "/settings/ai": Sparkles,
  "/settings/data": ListTree,
  "/settings/system": MonitorCog,
};
