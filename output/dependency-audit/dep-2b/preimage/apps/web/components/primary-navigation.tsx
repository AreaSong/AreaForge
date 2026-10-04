"use client";

import Link from "next/link";
import {
  BookOpen,
  CalendarCheck2,
  FileCheck2,
  PanelLeftClose,
  PanelLeftOpen,
  Route,
  Settings,
  Timer,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { BrandMark } from "@/components/brand-logo";
import { LogoutButton } from "@/components/logout-button";
import { PRIMARY_WORKBENCH_ITEMS, UTILITY_NAV_ITEM } from "@/lib/navigation/app-navigation";
import type { AppNavigationItem } from "@/lib/navigation/app-navigation";
import { IconButton } from "@/components/ui/button";

export function PrimaryNavigation(props: {
  pathname: string;
  collapsed: boolean;
  email: string;
  userId: string;
  onToggle: () => void;
}) {
  return (
    <aside
      aria-label="一级导航"
      data-navigation-level="primary"
      data-layout-region="primary-navigation"
      className={`af-primary-navigation-rail hidden shrink-0 flex-col border-r border-white/10 bg-[var(--af-surface-subtle)] px-3 py-5 transition-[width] min-[1024px]:flex ${props.collapsed ? "w-[60px]" : "w-[184px]"}`}
    >
      <div className={`mb-6 flex items-center text-teal-300 ${props.collapsed ? "justify-center" : "justify-between gap-2 px-2"}`}>
        <div className="flex min-w-0 items-center gap-2">
          <BrandMark size={22} />
          <span data-primary-label className={props.collapsed ? "sr-only" : "truncate text-sm font-medium"}>AreaForge</span>
        </div>
        <IconButton
          label={props.collapsed ? "展开一级导航" : "收起一级导航"}
          size="sm"
          type="button"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white"
          onClick={props.onToggle}
          title={props.collapsed ? "展开一级导航" : "收起一级导航"}
          aria-expanded={!props.collapsed}
          aria-controls="primary-navigation"
        >
          {props.collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
        </IconButton>
      </div>
      <nav id="primary-navigation" className="flex flex-col gap-1" aria-label="主导航">
        {PRIMARY_WORKBENCH_ITEMS.map((item) => (
          <PrimaryLink key={item.href} item={item} pathname={props.pathname} collapsed={props.collapsed} />
        ))}
      </nav>
      <div className={`mt-auto space-y-2 border-t border-white/10 pt-4 text-xs text-zinc-500 ${props.collapsed ? "grid justify-items-center" : "px-2"}`}>
        <PrimaryLink item={UTILITY_NAV_ITEM} pathname={props.pathname} collapsed={props.collapsed} />
        <p data-primary-email className={props.collapsed ? "sr-only" : undefined}>{props.email}</p>
        <LogoutButton compact={props.collapsed} userId={props.userId} />
      </div>
    </aside>
  );
}

function PrimaryLink(props: { item: AppNavigationItem; pathname: string; collapsed: boolean }) {
  const active = props.item.match(props.pathname);
  const activeChild = props.item.children?.some((child) => child.match(props.pathname)) ?? false;
  return (
    <Link
      href={props.item.href}
      aria-current={active ? (activeChild ? "location" : navigationAriaCurrent(props.pathname, props.item)) : undefined}
      title={props.collapsed ? props.item.label : undefined}
      className={`group flex min-w-0 items-center rounded-md border-l-2 py-2 text-sm transition-all duration-300 ease-out ${props.collapsed ? "justify-center px-2" : "gap-3 px-3"} ${active ? "border-teal-300 shadow-[-2px_0_12px_rgba(45,212,191,0.25)] bg-gradient-to-r from-teal-400/[0.08] to-transparent text-white" : "border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-100"}`}
    >
      <NavigationIcon href={props.item.href} />
      <span data-primary-label className={props.collapsed ? "sr-only" : "truncate"}>{props.item.label}</span>
    </Link>
  );
}

function navigationAriaCurrent(pathname: string, item: { href: string; match: (path: string) => boolean }): "page" | "location" | undefined {
  if (!item.match(pathname)) return undefined;
  return pathname === item.href ? "page" : "location";
}

function NavigationIcon({ href }: { href: string }) {
  const Icon = PRIMARY_NAVIGATION_ICONS[href] ?? Settings;
  return <Icon className="h-4 w-4 shrink-0 transition-transform duration-300 group-hover:scale-110 group-active:scale-95" aria-hidden="true" />;
}

const PRIMARY_NAVIGATION_ICONS: Record<string, LucideIcon> = {
  "/focus": Timer,
  "/today": CalendarCheck2,
  "/knowledge": BookOpen,
  "/test/retests": FileCheck2,
  "/roadmap": Route,
  "/settings/exams": Settings,
};
