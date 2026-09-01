"use client";

import type React from "react";
import {
  Command,
  Search,
  X,
} from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import type {
  DynamicIslandCapsuleKind,
  DynamicIslandCapsuleState,
} from "./dynamic-island-types";

// ============================================================================
// CapsuleBreathingDots: Multi-state carousel pagination indicator
// ============================================================================

export interface CapsuleBreathingDotsProps {
  count: number;
  activeIndex: number;
  className?: string;
}

export function CapsuleBreathingDots({ count, activeIndex, className }: CapsuleBreathingDotsProps) {
  if (count <= 1) return null;

  return (
    <div
      className={`inline-flex items-center gap-1 pl-1 select-none ${className ?? ""}`}
      title={`多状态轮播 (${activeIndex + 1}/${count})`}
      aria-label={`多状态轮播，当前第 ${activeIndex + 1} 项，共 ${count} 项`}
    >
      {Array.from({ length: count }).map((_, idx) => (
        <span
          key={idx}
          className={`rounded-full transition-all duration-300 ${
            idx === activeIndex
              ? "size-1.5 bg-teal-400 shadow-[0_0_6px_rgba(45,212,191,0.8)] animate-pulse"
              : "size-1 bg-white/25 hover:bg-white/40"
          }`}
        />
      ))}
    </div>
  );
}

// ============================================================================
// CapsuleCenterSegment: Search Input, Icon & ⌘K Command Palette Trigger
// ============================================================================

export interface CapsuleCenterSegmentProps {
  query: string;
  onQueryChange: (query: string) => void;
  onOpenSearch: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onClearQuery?: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  activeKind?: DynamicIslandCapsuleKind;
  capsuleState?: DynamicIslandCapsuleState;
  className?: string;
}

export function CapsuleCenterSegment(props: CapsuleCenterSegmentProps) {
  const {
    query,
    onQueryChange,
    onOpenSearch,
    onKeyDown,
    onClearQuery,
    inputRef,
    activeKind,
    capsuleState,
    className,
  } = props;

  const kind = activeKind ?? capsuleState?.kind ?? "idle";

  return (
    <div
      onClick={() => {
        onOpenSearch();
        inputRef?.current?.focus();
      }}
      className={`flex flex-1 min-w-0 items-center gap-1.5 px-1 cursor-text ${className ?? ""}`}
    >
      <Search size={13} className="shrink-0 text-zinc-500 transition-colors" />
      <Input
        ref={inputRef}
        type="text"
        value={query}
        onFocus={() => onOpenSearch()}
        onChange={(e) => {
          onQueryChange(e.target.value);
          onOpenSearch();
        }}
        onKeyDown={onKeyDown}
        placeholder={
          kind === "live_session_running"
            ? "搜索命令…"
            : kind !== "idle"
              ? "搜索或输入命令…"
              : "搜索或输入命令… ⌘K"
        }
        className="af-island-input !h-auto !min-h-0 !border-0 !bg-transparent !p-0 text-xs text-white placeholder:text-zinc-500 !ring-0 !shadow-none !outline-none focus:!border-0 focus:!ring-0 focus-visible:!outline-none selection:bg-teal-500/30 w-full min-w-0"
        style={{ outline: "none", boxShadow: "none", border: "none" }}
        aria-label="全局灵动岛搜索与命令输入框"
      />
      {query ? (
        <IconButton
          label="清除搜索输入"
          type="button"
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onClearQuery?.();
            inputRef?.current?.focus();
          }}
          className="!h-5 !w-5 !p-0.5 text-zinc-400 hover:text-white transition-colors cursor-pointer shrink-0"
        >
          <X size={13} />
        </IconButton>
      ) : kind === "idle" ? (
        <span className="inline-flex items-center gap-0.5 rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-mono text-zinc-500 shrink-0 select-none">
          <Command size={11} />K
        </span>
      ) : null}
    </div>
  );
}
