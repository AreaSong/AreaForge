"use client";

import type React from "react";
import {
  Clock3,
  CornerDownLeft,
  Layers,
  Moon,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GlobalCommandDefinition } from "@/lib/navigation/command-palette";
import type {
  DynamicIslandActiveItem,
  DynamicIslandAuraTheme,
  DynamicIslandStateKind,
} from "./dynamic-island-types";
import {
  getAuraStyles,
  getAuraThemeForStateKind,
} from "./dynamic-island-glow";

export type HubViewMode =
  | "search"
  | "overview"
  | "focus"
  | "closure"
  | "status"
  | "stopwatch"
  | "evening";

export function normalizeHubTab(
  tab?: string | null
): "search" | "overview" | "focus" | "closure" {
  if (!tab) return "search";
  if (tab === "status" || tab === "overview") return "overview";
  if (tab === "stopwatch" || tab === "focus") return "focus";
  if (tab === "evening" || tab === "closure") return "closure";
  return "search";
}

export function HubViewModeTabs(props: {
  viewMode: HubViewMode;
  onViewModeChange: (mode: HubViewMode) => void;
  activeStatesCount: number;
  hasRunningSession: boolean;
  pendingConfirmationsCount: number;
  eveningDue: boolean;
  auraTheme?: DynamicIslandAuraTheme | DynamicIslandStateKind;
  dominantState?: DynamicIslandActiveItem;
}) {
  const {
    viewMode,
    onViewModeChange,
    activeStatesCount,
    hasRunningSession,
    pendingConfirmationsCount,
    eveningDue,
    auraTheme,
    dominantState,
  } = props;

  const resolvedTheme: DynamicIslandAuraTheme = auraTheme
    ? (typeof auraTheme === "string" &&
      ["indigo", "amber", "teal", "silver"].includes(auraTheme)
        ? (auraTheme as DynamicIslandAuraTheme)
        : getAuraThemeForStateKind(auraTheme as DynamicIslandStateKind))
    : dominantState
    ? getAuraThemeForStateKind(dominantState.kind)
    : "teal";

  const auraStyles = getAuraStyles(resolvedTheme);
  const normalizedActiveMode = normalizeHubTab(viewMode);

  const tabs: Array<{
    id: HubViewMode;
    label: string;
    icon: React.ReactNode;
    badge?: React.ReactNode;
  }> = [
    { id: "search", label: "命令搜索", icon: <Search size={12} /> },
    {
      id: "overview",
      label: "督战全景",
      icon: <Layers size={12} />,
      badge:
        activeStatesCount > 0 ? (
          <span className="ml-1 rounded-full bg-teal-400/20 px-1 text-[9px] font-mono text-teal-300">
            {activeStatesCount}
          </span>
        ) : null,
    },
    {
      id: "focus",
      label: "专注心流",
      icon: <Clock3 size={12} />,
      badge: hasRunningSession ? (
        <span className="ml-1 size-1.5 rounded-full bg-teal-400 animate-pulse" />
      ) : null,
    },
    {
      id: "closure",
      label: "晚间指引",
      icon: <Moon size={12} />,
      badge:
        pendingConfirmationsCount > 0 || eveningDue ? (
          <span className="ml-1 rounded-full bg-amber-400/20 px-1 text-[9px] font-mono text-amber-300">
            {pendingConfirmationsCount > 0 ? pendingConfirmationsCount : "!"}
          </span>
        ) : null,
    },
  ];

  return (
    <div className="flex items-center gap-1 border-b border-white/10 pb-2 mb-2 select-none overflow-x-auto focus-scrollbar">
      {tabs.map((t) => {
        const isActive =
          viewMode === t.id || normalizeHubTab(t.id) === normalizedActiveMode;

        return (
          <Button
            key={t.id}
            type="button"
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onViewModeChange(t.id);
            }}
            className={`flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
              isActive
                ? auraStyles.tabActiveClass
                : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200 border border-transparent"
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
            {t.badge}
          </Button>
        );
      })}
    </div>
  );
}

export function HubCommandPaletteList(props: {
  commands: readonly GlobalCommandDefinition[];
  selectedIndex: number;
  onSelectIndex: (idx: number) => void;
  onExecuteCommand: (cmd: GlobalCommandDefinition) => void;
  auraTheme?: DynamicIslandAuraTheme;
}) {
  const {
    commands,
    selectedIndex,
    onSelectIndex,
    onExecuteCommand,
    auraTheme = "silver",
  } = props;

  const selectedClass =
    auraTheme === "indigo"
      ? "bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-400/30 shadow-[0_0_8px_rgba(99,102,241,0.15)]"
      : auraTheme === "amber"
      ? "bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/30 shadow-[0_0_8px_rgba(245,158,11,0.15)]"
      : auraTheme === "teal"
      ? "bg-teal-500/15 text-teal-200 ring-1 ring-teal-400/30 shadow-[0_0_8px_rgba(45,212,191,0.15)]"
      : "bg-white/10 text-white ring-1 ring-white/10 shadow-[0_0_8px_rgba(255,255,255,0.08)]";

  const jumpTagClass =
    auraTheme === "indigo"
      ? "text-indigo-400"
      : auraTheme === "amber"
      ? "text-amber-400"
      : auraTheme === "teal"
      ? "text-teal-400"
      : "text-zinc-300";

  return (
    <div className="max-h-60 overflow-y-auto space-y-0.5 focus-scrollbar pt-1">
      {commands.length > 0 ? (
        commands.map((cmd, idx) => {
          const isSelected = idx === selectedIndex;
          return (
            <div
              key={cmd.id}
              onClick={() => onExecuteCommand(cmd)}
              onMouseEnter={() => onSelectIndex(idx)}
              className={`flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors ${
                isSelected
                  ? selectedClass
                  : "text-zinc-300 hover:bg-white/5"
              }`}
              role="option"
              aria-selected={isSelected}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-medium text-white truncate">
                  {cmd.label}
                </span>
                <span className="hidden sm:inline text-[11px] text-zinc-500 truncate">
                  {cmd.description}
                </span>
              </div>
              {isSelected ? (
                <span
                  className={`flex items-center gap-1 text-[10px] font-mono shrink-0 ${jumpTagClass}`}
                >
                  <span>跳转</span>
                  <CornerDownLeft size={11} />
                </span>
              ) : null}
            </div>
          );
        })
      ) : (
        <div className="py-6 text-center text-xs text-zinc-500">
          未找到匹配的结果或命令
        </div>
      )}
    </div>
  );
}
