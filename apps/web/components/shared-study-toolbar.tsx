"use client";

import { AlertTriangle, ArrowLeft, CloudOff, Monitor, Wifi, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AppShellLight } from "@areaforge/core";
import { getClientDeviceIdentity, type ClientDeviceIdentity } from "@/lib/client/device-identity";
import { getNavigationTrail, sanitizeReturnPath } from "@/lib/navigation/app-navigation";
import type { StudySessionDevicePresenceDto, StudySessionDto } from "@/lib/study/types";
import { isActivitySourcePath } from "@/lib/study/activity-route";
import { WindowDock } from "@/components/window-dock";
import { useWindowSystem } from "@/components/window-system";

const RECENT_PAGE_KEY = "af.navigation.previous.v2";

type PreviousPage = { href: string; label: string } | null;
const previousPageListeners = new Set<() => void>();
let previousPageSnapshot: PreviousPage = null;
const serverNowSnapshot = new Date(0);
// Keep the first client snapshot identical to the server snapshot. The real
// clock is installed once the external-store subscription is mounted.
let nowSnapshot = serverNowSnapshot;
let nowTimer: number | null = null;
const nowListeners = new Set<() => void>();

function subscribeNow(listener: () => void): () => void {
  nowListeners.add(listener);
  if (nowTimer === null && typeof window !== "undefined") {
    nowSnapshot = new Date();
    listener();
    nowTimer = window.setInterval(() => {
      nowSnapshot = new Date();
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
  return nowSnapshot;
}

function getServerNowSnapshot(): Date {
  return serverNowSnapshot;
}

function subscribePreviousPage(listener: () => void): () => void {
  previousPageListeners.add(listener);
  return () => previousPageListeners.delete(listener);
}

function getPreviousPageSnapshot(): PreviousPage {
  return previousPageSnapshot;
}

function getServerPreviousPageSnapshot(): PreviousPage {
  return null;
}

function publishPreviousPage(currentHref: string): void {
  if (typeof window === "undefined") return;

  const current = sanitizeReturnPath(currentHref);
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(RECENT_PAGE_KEY);
  } catch {
    previousPageSnapshot = null;
  }
  const previousHref = normalizePreviousHref(raw);
  const previousTrail = previousHref && previousHref !== current ? getNavigationTrail(getPathname(previousHref)) : [];
  const previous = previousTrail.at(-1);
  previousPageSnapshot = previous && previousHref ? { href: previousHref, label: previous.label } : null;
  try {
    window.sessionStorage.setItem(RECENT_PAGE_KEY, current);
  } catch {
    // The toolbar remains usable without a recent-page hint.
  }
  for (const listener of previousPageListeners) listener();
}

export type SharedToolbarSyncState = "current" | "pending" | "offline" | "blocked" | "deferred" | "unavailable";

export function GlobalContextStatusBar(props: {
  pathname: string;
  currentHref?: string;
  activeSession: StudySessionDto | null;
  syncState: SharedToolbarSyncState;
  serverTime?: string;
  statusLights?: readonly AppShellLight[];
}) {
  const { foregroundKey } = useWindowSystem();
  const now = useSyncExternalStore(
    subscribeNow,
    getNowSnapshot,
    getServerNowSnapshot,
  );
  const [deviceIdentity, setDeviceIdentity] = useState<ClientDeviceIdentity | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsRef = useRef<HTMLDivElement>(null);
  const detailsTriggerRef = useRef<HTMLButtonElement>(null);
  const lastDetailsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const detailsId = useId();
  const previousPage = useSyncExternalStore(
    subscribePreviousPage,
    getPreviousPageSnapshot,
    getServerPreviousPageSnapshot,
  );
  const currentHref = props.currentHref ?? props.pathname;

  useEffect(() => {
    const timer = window.setTimeout(() => setDeviceIdentity(getClientDeviceIdentity()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    publishPreviousPage(currentHref);
  }, [currentHref]);

  const active = props.activeSession;
  const syncLabel = props.syncState === "offline"
    ? "离线"
    : props.syncState === "pending"
      ? "待同步"
      : props.syncState === "blocked"
        ? "需要对账"
        : props.syncState === "deferred"
          ? "同步已暂缓"
          : props.syncState === "unavailable"
            ? "同步异常"
            : "已同步";
  const otherDevices = useMemo(() => {
    if (!active) return [];
    return active.devicePresences.filter((presence) => !deviceIdentity || presence.deviceId !== deviceIdentity.id);
  }, [active, deviceIdentity]);
  const fallbackSourceDevice = active?.clientDeviceId && deviceIdentity && active.clientDeviceId !== deviceIdentity.id
    ? active.clientDeviceLabel ?? "其他设备"
    : null;
  const heartbeatAge = active?.lastHeartbeatAt ? Math.max(0, now.getTime() - Date.parse(active.lastHeartbeatAt)) : null;
  const fallbackSourceDeviceOnline = fallbackSourceDevice !== null && heartbeatAge !== null && heartbeatAge <= 45_000;
  const otherDeviceOnline = otherDevices.some((presence) => {
    const age = now.getTime() - Date.parse(presence.lastSeenAt);
    return Number.isFinite(age) && age <= 45_000;
  });
  const presenceLabels = otherDevices.slice(0, 2).map((presence) => {
    const age = now.getTime() - Date.parse(presence.lastSeenAt);
    return `${presence.deviceLabel}${Number.isFinite(age) && age <= 45_000 ? " · 在线" : " · 最近活动"}`;
  });
  if (otherDevices.length > 2) presenceLabels.push(`另有 ${otherDevices.length - 2} 台`);
  const presenceText = presenceLabels.length > 0
    ? presenceLabels.join("、")
    : fallbackSourceDevice
      ? `${fallbackSourceDevice}${fallbackSourceDeviceOnline ? " · 在线" : " · 最近活动"}`
      : "本设备";
  const attentionLights = (props.statusLights ?? []).filter((light) => light.tone === "amber" || light.tone === "red");
  const hasContextDetails = attentionLights.length > 0 || otherDevices.length > 0 || fallbackSourceDevice !== null || props.syncState !== "current";
  const closeoutStatusLabel = active?.status !== "closing"
    ? null
    : isActivitySourcePath(props.pathname, active)
      ? "正在完成收口"
      : foregroundKey === "session-closeout"
        ? "收口窗口正在前台"
        : "收口窗口已保留在后台";

  useEffect(() => {
    if (!detailsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && detailsRef.current?.contains(target)) return;
      setDetailsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDetailsOpen(false);
        lastDetailsTriggerRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [detailsOpen]);

  return (
    <footer
      className="af-shared-toolbar relative z-[var(--af-layer-shell-chrome)] shrink-0 border-t border-white/10 bg-[var(--af-surface-subtle)] px-2 py-1 text-xs sm:px-6 xl:px-8"
      data-layout-region="global-context-status-bar"
      data-global-ai-ui="true"
    >
      <div className="flex h-8 min-w-0 flex-nowrap items-center gap-2">
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          {previousPage && previousPage.href !== currentHref ? (
            <Link href={previousPage.href} className="inline-flex min-w-0 items-center gap-1.5 text-zinc-500 hover:text-zinc-200" title="返回刚才的页面" aria-label={`返回刚才的页面：${previousPage.label}`}>
              <ArrowLeft size={13} aria-hidden="true" />
              <span className="hidden max-w-40 truncate min-[420px]:inline">刚才：{previousPage.label}</span>
            </Link>
          ) : <span className="hidden truncate text-zinc-700 min-[420px]:inline">当前页面</span>}
        </div>

        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 overflow-visible">
          {closeoutStatusLabel ? (
            <span className="hidden min-w-0 shrink items-center gap-1.5 text-amber-200 min-[480px]:inline-flex" role="status">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" aria-hidden="true" />
              <span className="max-w-48 truncate">{closeoutStatusLabel}</span>
            </span>
          ) : null}
          {attentionLights.length > 0 ? (
            <button
              type="button"
              className="hidden min-w-0 max-w-56 items-center gap-1.5 rounded-md px-1.5 text-amber-200 hover:bg-amber-300/[0.08] xl:inline-flex"
              onClick={(event) => {
                lastDetailsTriggerRef.current = event.currentTarget;
                setDetailsOpen((current) => !current);
              }}
              aria-label={`查看状态提醒：${attentionLights[0].summary}`}
              aria-expanded={detailsOpen}
              aria-controls={detailsId}
            >
              <AlertTriangle size={13} className="shrink-0" aria-hidden="true" />
              <span className="truncate">{attentionLights[0].summary}</span>
            </button>
          ) : null}
          <WindowDock />
        </div>

        <div className="flex min-w-0 shrink-0 items-center justify-end gap-1.5 text-zinc-500">
          {hasContextDetails ? (
            <button
              ref={detailsTriggerRef}
              type="button"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-white/10 px-2 text-xs text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
              onClick={(event) => {
                lastDetailsTriggerRef.current = event.currentTarget;
                setDetailsOpen((current) => !current);
              }}
              aria-label="查看系统状态详情"
              aria-expanded={detailsOpen}
              aria-controls={detailsId}
            >
              <AlertTriangle size={13} className={attentionLights.length > 0 ? "text-amber-300" : "text-zinc-500"} aria-hidden="true" />
              <span className="hidden sm:inline">状态</span>
            </button>
          ) : null}
          <span className="hidden min-w-0 items-center gap-1.5 md:inline-flex" role="status" title="当前设备">
            <Monitor size={13} aria-hidden="true" />
            <span className="max-w-28 truncate">{deviceIdentity?.label ?? "当前设备"}</span>
          </span>
          {active && (otherDevices.length > 0 || fallbackSourceDevice) ? (
            <span
              className={`hidden min-w-0 items-center gap-1.5 lg:inline-flex ${otherDeviceOnline || fallbackSourceDeviceOnline ? "text-amber-200" : "text-zinc-500"}`}
              role="status"
              title={otherDevices.length > 0 ? `其他设备：${otherDevices.map((presence) => presence.deviceLabel).join("、")}` : `活动来自${fallbackSourceDevice}`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${otherDeviceOnline || fallbackSourceDeviceOnline ? "bg-amber-300" : "bg-zinc-600"}`} aria-hidden="true" />
              <span className="max-w-44 truncate">{presenceText}</span>
            </span>
          ) : null}
          <span className={`inline-flex shrink-0 items-center gap-1.5 ${props.syncState === "current" ? "text-zinc-500" : "text-amber-200"}`} role="status" aria-live="polite">
            {props.syncState === "current" ? <Wifi size={13} aria-hidden="true" /> : <CloudOff size={13} aria-hidden="true" />}
            <span className="hidden min-[360px]:inline">{syncLabel}</span>
            {props.serverTime ? <span className="hidden text-zinc-700 xl:inline">· {formatServerTime(props.serverTime)}</span> : null}
          </span>
        </div>
      </div>
      {detailsOpen && hasContextDetails ? (
        <div ref={detailsRef} id={detailsId} className="absolute bottom-[calc(100%+0.5rem)] right-4 z-[var(--af-layer-shell-popover)] w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-white/15 bg-[#101419] p-4 text-sm shadow-2xl" role="dialog" aria-modal="false" aria-labelledby={`${detailsId}-title`}>
          <div className="flex items-center gap-3">
            <h2 id={`${detailsId}-title`} className="min-w-0 flex-1 font-medium text-zinc-100">系统状态</h2>
            <button type="button" className="inline-flex size-8 items-center justify-center rounded-md text-zinc-500 hover:bg-white/10 hover:text-zinc-200" onClick={() => { setDetailsOpen(false); lastDetailsTriggerRef.current?.focus({ preventScroll: true }); }} aria-label="关闭系统状态详情">
              <X size={15} aria-hidden="true" />
            </button>
          </div>
          <div className="mt-3 space-y-3">
            {attentionLights.map((light) => (
              <div key={light.kind} className="rounded-md border border-amber-300/20 bg-amber-300/[0.05] p-3">
                <p className="text-xs font-medium text-amber-200">{light.label}</p>
                <p className="mt-1 leading-5 text-zinc-300">{light.summary}</p>
                {light.action ? <Link href={light.action.href} className="mt-2 inline-flex text-xs text-teal-200 hover:underline" onClick={() => setDetailsOpen(false)}>{light.action.label}</Link> : null}
              </div>
            ))}
            <div className="grid gap-2 border-t border-white/10 pt-3 text-xs text-zinc-400">
              <p><span className="text-zinc-600">当前设备：</span>{deviceIdentity?.label ?? "当前设备"}</p>
              <p><span className="text-zinc-600">同步：</span>{syncLabel}{props.serverTime ? ` · ${formatServerTime(props.serverTime)}` : ""}</p>
              <div>
                <p className="text-zinc-600">其他设备：</p>
                {otherDevices.length > 0 ? (
                  <ul className="mt-1 space-y-1 text-zinc-300">
                    {otherDevices.map((presence) => <li key={presence.deviceId}>{presence.deviceLabel} · {presenceTextForPresence(presence, now)}</li>)}
                  </ul>
                ) : fallbackSourceDevice ? <p className="mt-1 text-zinc-300">{fallbackSourceDevice} · {fallbackSourceDeviceOnline ? "在线" : "最近活动"}</p> : <p className="mt-1 text-zinc-500">当前没有正在接力的其他设备</p>}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </footer>
  );
}

/** Compatibility alias for page-level imports that still use the old name. */
export const SharedStudyToolbar = GlobalContextStatusBar;

function formatServerTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(parsed);
}

function presenceTextForPresence(presence: StudySessionDevicePresenceDto, now: Date): string {
  const age = now.getTime() - Date.parse(presence.lastSeenAt);
  return Number.isFinite(age) && age <= 45_000 ? "在线" : "最近活动";
}

function getPathname(value: string): string {
  try {
    return new URL(value, "https://areaforge.invalid").pathname;
  } catch {
    return value.split("?", 1)[0].split("#", 1)[0];
  }
}

function normalizePreviousHref(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return sanitizeReturnPath(value);
}
