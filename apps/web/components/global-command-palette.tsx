"use client";

import { Command, CornerDownLeft, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  clampCommandIndex,
  GLOBAL_COMMANDS,
  filterGlobalCommands,
  getGlobalCommandHref,
  type GlobalCommandAction,
  type GlobalCommandDefinition,
  resolveGlobalCommand,
} from "@/lib/navigation/command-palette";

export function GlobalCommandPalette(props: {
  trigger: ReactNode;
  triggerLabel: string;
  onOpenAction: (action: GlobalCommandAction) => void;
  commands?: readonly GlobalCommandDefinition[];
  compactOnNarrow?: boolean;
}) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const commands = useMemo(() => filterGlobalCommands(query, props.commands ?? GLOBAL_COMMANDS), [props.commands, query]);
  const hasQuery = query.trim().length > 0;

  const openPalette = useCallback(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : triggerRef.current;
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
    window.setTimeout(() => {
      const target = restoreFocusRef.current ?? triggerRef.current;
      if (target?.isConnected && !target.hasAttribute("disabled")) target.focus({ preventScroll: true });
    }, 0);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openPalette();
        return;
      }
      if (event.key === "Escape" && open) {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, open, openPalette]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const selectedIndex = clampCommandIndex(activeIndex, commands.length);

  function execute(command: GlobalCommandDefinition) {
    const resolved = resolveGlobalCommand(query, props.commands ?? GLOBAL_COMMANDS);
    const execution = resolved?.definition.id === command.id
      ? resolved.execution
      : { rawQuery: query, argumentText: "", args: [], namedArgs: {} };
    const href = getGlobalCommandHref(command, execution);
    if (href) router.push(href);
    if (command.action) props.onOpenAction(command.action);
    close();
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => commands.length ? (current + 1) % commands.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => commands.length ? (current - 1 + commands.length) % commands.length : 0);
    } else if (event.key === "Enter" && commands[selectedIndex]) {
      event.preventDefault();
      execute(commands[selectedIndex]);
    }
  }

  function onDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>([
      "input:not([disabled])",
      "button:not([disabled])",
      "a[href]",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",")) ?? []);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? (current <= 0 ? focusable.length - 1 : current - 1)
      : (current + 1) % focusable.length;
    event.preventDefault();
    focusable[next]?.focus({ preventScroll: true });
  }

  const now = useSyncExternalStore(subscribeNow, getNowSnapshot, getServerNowSnapshot);
  const timeLabel = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`group mx-auto flex h-9 w-full min-w-0 max-w-[42rem] flex-1 items-center justify-between gap-3 rounded-md border border-white/10 bg-[#0b0f14] px-3 text-left text-xs text-zinc-400 hover:border-teal-300/35 hover:bg-white/[0.04] ${props.compactOnNarrow ? "max-[359px]:w-9 max-[359px]:flex-none max-[359px]:justify-center max-[359px]:px-0" : ""}`}
        onClick={openPalette}
        aria-label={props.triggerLabel}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <Search size={15} className="shrink-0 text-zinc-600 group-hover:text-teal-300" aria-hidden="true" />
          <span className={`min-w-0 flex-1 truncate ${props.compactOnNarrow ? "max-[359px]:hidden" : ""}`}>{props.trigger}</span>
        </span>
        <span className="hidden shrink-0 items-center gap-1 text-[10px] text-zinc-600 sm:inline-flex">
          <Command size={12} aria-hidden="true" />K
        </span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[var(--af-layer-modal)] bg-black/55 p-4 sm:p-8" role="presentation" onMouseDown={close}>
          <section
            ref={dialogRef}
            className="mx-auto mt-[8vh] w-full max-w-2xl overflow-hidden rounded-lg border border-white/15 bg-[#101419] shadow-2xl shadow-black/60"
            role="dialog"
            aria-modal="true"
            aria-label="全局命令面板"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={onDialogKeyDown}
          >
            <div className="flex items-center gap-3 border-b border-white/10 px-4">
              <Search size={17} className="shrink-0 text-teal-300" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onInputKeyDown}
                className="h-14 min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
                placeholder="搜索或输入命令：$today /start"
                aria-label="搜索或输入命令"
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className="hidden shrink-0 items-center gap-1 rounded border border-white/10 px-1.5 py-1 text-[10px] text-zinc-600 sm:inline-flex"><CornerDownLeft size={11} aria-hidden="true" />Enter</kbd>
            </div>
            <div className="max-h-[min(28rem,60vh)] overflow-y-auto p-2">
              {!hasQuery ? (
                <div className="px-4 py-10 text-center">
                  <p className="text-3xl font-semibold tabular-nums tracking-tight text-zinc-100">{timeLabel}</p>
                  <p className="mt-3 text-sm text-zinc-500">搜索页面、对象或输入命令</p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2 text-xs text-zinc-400">
                    {["$today", "/start_to_learn now", "打开知识", "设置 AI"].map((hint) => (
                      <button key={hint} type="button" className="rounded-md border border-white/10 px-2.5 py-1.5 hover:border-teal-300/35 hover:text-teal-200" onClick={() => setQuery(hint)}>{hint}</button>
                    ))}
                  </div>
                </div>
              ) : commands.length > 0 ? commands.map((command, index) => (
                <button
                  key={command.id}
                  type="button"
                  className={`flex w-full items-start gap-3 rounded-md px-3 py-3 text-left ${index === selectedIndex ? "bg-teal-300/[0.08]" : "hover:bg-white/[0.04]"}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => execute(command)}
                >
                  <span className="mt-0.5 size-2 shrink-0 rounded-full bg-teal-300/70" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-zinc-100">{command.label}</span>
                    <span className="mt-0.5 block truncate text-xs text-zinc-500">{command.description}</span>
                  </span>
                  <span className="hidden shrink-0 text-[10px] text-zinc-600 sm:block">{command.aliases[0]}</span>
                </button>
              )) : <p className="px-3 py-10 text-center text-sm text-zinc-500">没有匹配的命令</p>}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/10 px-4 py-2 text-[10px] text-zinc-600">
              <span>↑↓ 选择</span><span>Enter 执行</span><span>Esc 关闭</span>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

const serverNow = new Date(0);
let currentNow = serverNow;
const nowListeners = new Set<() => void>();
let nowTimer: number | null = null;

function subscribeNow(listener: () => void): () => void {
  nowListeners.add(listener);
  if (nowTimer === null && typeof window !== "undefined") {
    currentNow = new Date();
    listener();
    nowTimer = window.setInterval(() => {
      currentNow = new Date();
      for (const currentListener of nowListeners) currentListener();
    }, 1_000);
  }
  return () => {
    nowListeners.delete(listener);
    if (nowListeners.size === 0 && nowTimer !== null) {
      window.clearInterval(nowTimer);
      nowTimer = null;
    }
  };
}

function getNowSnapshot(): Date {
  return currentNow;
}

function getServerNowSnapshot(): Date {
  return serverNow;
}
