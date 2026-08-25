"use client";

import { AlertTriangle, ArrowLeft, Clock3, CloudOff, Monitor, RotateCcw, Save, Wifi, X } from "lucide-react";
import Link from "next/link";
import { memo, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AppShellLight } from "@areaforge/core";
import {
  getClientDeviceIdentity,
  setClientDeviceLabel,
  subscribeClientDeviceIdentity,
  type ClientDeviceIdentity,
} from "@/lib/client/device-identity";
import { getNavigationTrail, sanitizeReturnPath } from "@/lib/navigation/app-navigation";
import type { StudySessionDevicePresenceDto, StudySessionDto } from "@/lib/contracts";
import { isActivitySourcePath } from "@/lib/navigation/activity-route";
import { formatClockTimeMillis } from "@/lib/formatters";
import { WindowDock } from "@/components/window-dock";
import { useWindowSystem } from "@/components/window-system";
import { getBrowserStoragePort } from "@/lib/client/storage-port";
import { Button, IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

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
    raw = getBrowserStoragePort("session")?.getItem(RECENT_PAGE_KEY) ?? null;
  } catch {
    previousPageSnapshot = null;
  }
  const previousHref = normalizePreviousHref(raw);
  const previousTrail = previousHref && previousHref !== current ? getNavigationTrail(getPathname(previousHref)) : [];
  const previous = previousTrail.at(-1);
  previousPageSnapshot = previous && previousHref ? { href: previousHref, label: previous.label } : null;
  try {
    getBrowserStoragePort("session")?.setItem(RECENT_PAGE_KEY, current);
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
  const [deviceLabelDraft, setDeviceLabelDraft] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsSide, setDetailsSide] = useState<"left" | "right">("right");
  const detailsRef = useRef<HTMLDivElement>(null);
  const lastDetailsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const detailsId = useId();
  const previousPage = useSyncExternalStore(
    subscribePreviousPage,
    getPreviousPageSnapshot,
    getServerPreviousPageSnapshot,
  );
  const currentHref = props.currentHref ?? props.pathname;

  useEffect(() => {
    const updateIdentity = () => {
      const identity = getClientDeviceIdentity();
      setDeviceIdentity(identity);
      setDeviceLabelDraft(identity.label);
    };
    const timer = window.setTimeout(updateIdentity, 0);
    const unsubscribe = subscribeClientDeviceIdentity(updateIdentity);
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
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
  const onlineOtherDeviceCount = otherDevices.filter((presence) => {
    const age = now.getTime() - Date.parse(presence.lastSeenAt);
    return Number.isFinite(age) && age <= 45_000;
  }).length;
  const otherDeviceCount = otherDevices.length > 0 ? otherDevices.length : fallbackSourceDevice ? 1 : 0;
  const activeOtherDeviceCount = otherDevices.length > 0 ? onlineOtherDeviceCount : fallbackSourceDeviceOnline ? 1 : 0;
  const attentionLights = (props.statusLights ?? []).filter((light) => (
    (light.tone === "amber" || light.tone === "red")
    && !(active?.status === "closing" && light.kind === "activity")
  ));
  const hasRedAttention = attentionLights.some((light) => light.tone === "red");
  const isActivitySource = Boolean(active?.status === "closing" && isActivitySourcePath(props.pathname, active));
  const closeoutStatusLabel = active?.status !== "closing"
    ? null
    : isActivitySource
      ? "正在收口"
      : foregroundKey === "session-closeout"
        ? "收口中"
        : null;
  useEffect(() => {
    if (!detailsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (detailsRef.current?.contains(target) || lastDetailsTriggerRef.current?.contains(target))) return;
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
      className="af-shared-toolbar relative z-[var(--af-layer-shell-chrome)] shrink-0 border-t border-white/10 bg-[var(--af-surface-subtle)]/75 px-2 py-1 text-xs backdrop-blur-md sm:px-6 xl:px-8"
      data-layout-region="global-context-status-bar"
      data-global-ai-ui="true"
    >
      <div className="grid h-8 min-w-0 grid-cols-[minmax(0,auto)_minmax(0,1fr)_auto] items-center gap-2">
        <div className="flex min-w-0 items-center gap-1.5" data-status-region="persistent">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className="hidden !h-7 min-w-0 shrink items-center gap-1.5 rounded-md !px-1.5 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200 lg:inline-flex"
            onClick={(event) => {
              lastDetailsTriggerRef.current = event.currentTarget;
              setDetailsSide("left");
              setDetailsOpen((current) => !current);
            }}
            aria-label={`本机：${deviceIdentity?.label ?? "当前设备"}`}
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
          >
            <Monitor size={13} aria-hidden="true" />
            <span className="max-w-36 truncate">本机 · {deviceIdentity?.label ?? "当前设备"}</span>
          </Button>
          {otherDeviceCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className={`hidden !h-7 min-w-0 shrink items-center gap-1.5 rounded-md !px-1.5 hover:bg-white/[0.06] lg:inline-flex ${activeOtherDeviceCount > 0 ? "text-amber-200" : "text-zinc-500"}`}
              onClick={(event) => {
                lastDetailsTriggerRef.current = event.currentTarget;
                setDetailsSide("left");
                setDetailsOpen((current) => !current);
              }}
              aria-label={`其他设备 ${otherDeviceCount} 台，${activeOtherDeviceCount} 台在线`}
              aria-expanded={detailsOpen}
              aria-controls={detailsId}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${activeOtherDeviceCount > 0 ? "bg-amber-300" : "bg-zinc-600"}`} aria-hidden="true" />
              <span>其他设备 {otherDeviceCount}</span>
            </Button>
          ) : null}
          {previousPage && previousPage.href !== currentHref ? (
            <Link href={previousPage.href} className="inline-flex min-w-0 items-center gap-1.5 text-zinc-500 hover:text-zinc-200" title="返回刚才的页面" aria-label={`返回刚才的页面：${previousPage.label}`}>
              <ArrowLeft size={13} aria-hidden="true" />
              <span className="hidden max-w-40 truncate min-[420px]:inline">刚才：{previousPage.label}</span>
            </Link>
          ) : null}
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2 overflow-visible outline-none" data-status-region="work" data-window-focus-fallback="true" tabIndex={-1} aria-label="后台窗口">
          {closeoutStatusLabel ? (
            <span className="hidden min-w-0 shrink items-center gap-1.5 text-amber-200 sm:inline-flex" role="status">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" aria-hidden="true" />
              <span className="max-w-48 truncate">{closeoutStatusLabel}</span>
            </span>
          ) : null}
          <WindowDock excludeKeys={isActivitySource ? ["session-closeout"] : undefined} />
        </div>

        <div className="flex min-w-0 shrink-0 items-center justify-end gap-1.5 text-zinc-500" data-status-region="system">
          {attentionLights.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className={`inline-flex !h-7 shrink-0 items-center gap-1 rounded-md border !px-2 text-xs hover:bg-white/[0.06] ${hasRedAttention ? "border-red-300/25 text-red-200" : "border-amber-300/20 text-amber-200"}`}
              onClick={(event) => {
                lastDetailsTriggerRef.current = event.currentTarget;
                setDetailsSide("right");
                setDetailsOpen((current) => !current);
              }}
              aria-label={`查看状态提醒，共 ${attentionLights.length} 条`}
              aria-expanded={detailsOpen}
              aria-controls={detailsId}
            >
              <AlertTriangle size={13} className="shrink-0" aria-hidden="true" />
              <span className="hidden min-[420px]:inline">{attentionLights.length}</span>
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className={`inline-flex !h-7 shrink-0 items-center gap-1.5 rounded-md !px-1.5 hover:bg-white/[0.06] ${props.syncState === "current" ? "text-zinc-500 hover:text-zinc-200" : "text-amber-200"}`}
            onClick={(event) => {
              lastDetailsTriggerRef.current = event.currentTarget;
              setDetailsSide("right");
              setDetailsOpen((current) => !current);
            }}
            aria-label={`同步状态：${syncLabel}`}
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
          >
            {props.syncState === "current" ? <Wifi size={13} aria-hidden="true" /> : <CloudOff size={13} aria-hidden="true" />}
            <span className="hidden min-[360px]:inline">{syncLabel}</span>
          </Button>
          <span className="hidden shrink-0 items-center gap-1 text-zinc-600 xl:inline-flex">
            <Clock3 size={13} aria-hidden="true" />
            <LiveMillisecondClock initialTime={props.serverTime} className="inline-block w-[12ch] font-mono tabular-nums" />
          </span>
        </div>
      </div>
      {detailsOpen ? (
        <div ref={detailsRef} id={detailsId} className={`absolute bottom-[calc(100%+0.5rem)] z-[var(--af-layer-shell-popover)] w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-white/15 bg-[#101419] p-4 text-sm shadow-2xl ${detailsSide === "left" ? "left-4" : "right-4"}`} role="dialog" aria-modal="false" aria-labelledby={`${detailsId}-title`}>
          <div className="flex items-center gap-3">
            <h2 id={`${detailsId}-title`} className="min-w-0 flex-1 font-medium text-zinc-100">设备与系统状态</h2>
            <IconButton label="关闭系统状态详情" type="button" size="sm" className="inline-flex !size-8 items-center justify-center rounded-md text-zinc-500 hover:bg-white/10 hover:text-zinc-200" onClick={() => { setDetailsOpen(false); lastDetailsTriggerRef.current?.focus({ preventScroll: true }); }}>
              <X size={15} aria-hidden="true" />
            </IconButton>
          </div>
          <div className="mt-3 space-y-3">
            {attentionLights.map((light) => (
              <div key={light.kind} className="rounded-md border border-amber-300/20 bg-amber-300/[0.05] p-3">
                <p className="text-xs font-medium text-amber-200">{light.label}</p>
                <p className="mt-1 leading-5 text-zinc-300">{light.summary}</p>
                {light.action ? <Link href={light.action.href} className="mt-2 inline-flex text-xs text-teal-200 hover:underline" onClick={() => setDetailsOpen(false)}>{light.action.label}</Link> : null}
              </div>
            ))}
            <form
              className="border-t border-white/10 pt-3"
              onSubmit={(event) => {
                event.preventDefault();
                const identity = setClientDeviceLabel(deviceLabelDraft);
                setDeviceIdentity(identity);
                setDeviceLabelDraft(identity.label);
              }}
            >
              <label htmlFor={`${detailsId}-device-label`} className="text-xs text-zinc-500">本机名称</label>
              <div className="mt-1.5 flex min-w-0 gap-2">
                <Input
                  id={`${detailsId}-device-label`}
                  value={deviceLabelDraft}
                  onChange={(event) => setDeviceLabelDraft(event.target.value)}
                  maxLength={40}
                  className="h-9 min-w-0 flex-1 rounded-md border border-white/10 bg-black/20 px-3 text-sm text-zinc-100 outline-none focus:border-teal-300/60"
                  placeholder={deviceIdentity?.detectedLabel ?? "当前设备"}
                />
                <Button type="submit" variant="primary" size="sm" className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-teal-300 px-3 text-xs font-medium text-slate-950 hover:bg-teal-200">
                  <Save size={13} aria-hidden="true" />保存
                </Button>
              </div>
              <div className="mt-2 flex min-w-0 items-center justify-between gap-3 text-xs text-zinc-600">
                <span className="truncate">自动识别：{deviceIdentity?.detectedLabel ?? "当前设备"}</span>
                {deviceIdentity && deviceIdentity.label !== deviceIdentity.detectedLabel ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    className="inline-flex !h-auto shrink-0 items-center gap-1 !border-0 !p-0 text-zinc-500 hover:text-zinc-200"
                    onClick={() => {
                      const identity = setClientDeviceLabel("");
                      setDeviceIdentity(identity);
                      setDeviceLabelDraft(identity.label);
                    }}
                  >
                    <RotateCcw size={12} aria-hidden="true" />使用自动名称
                  </Button>
                ) : null}
              </div>
            </form>
            <div className="grid gap-2 border-t border-white/10 pt-3 text-xs text-zinc-400">
              <p><span className="text-zinc-600">同步：</span>{syncLabel}</p>
              <p className="flex items-center gap-1"><span className="text-zinc-600">当前时间：</span><LiveMillisecondClock initialTime={props.serverTime} className="inline-block w-[12ch] font-mono tabular-nums" /></p>
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

const LiveMillisecondClock = memo(function LiveMillisecondClock(props: {
  initialTime?: string;
  className?: string;
}) {
  const timeRef = useRef<HTMLTimeElement>(null);
  const initialDate = props.initialTime ? new Date(props.initialTime) : null;
  const initialDateIsValid = initialDate !== null && !Number.isNaN(initialDate.getTime());
  const initialLabel = initialDateIsValid ? formatClockTime(initialDate) : "--:--:--.---";

  useEffect(() => {
    let frameId = 0;
    const update = () => {
      const current = new Date();
      const label = formatClockTime(current);
      if (timeRef.current) {
        timeRef.current.textContent = label;
        timeRef.current.dateTime = current.toISOString();
        timeRef.current.setAttribute("aria-label", `当前时间 ${label}`);
      }
      frameId = window.requestAnimationFrame(update);
    };
    update();
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  return (
    <time
      ref={timeRef}
      className={props.className}
      dateTime={initialDateIsValid ? initialDate.toISOString() : undefined}
      aria-label={`当前时间 ${initialLabel}`}
      aria-live="off"
      data-live-clock="millisecond"
    >
      {initialLabel}
    </time>
  );
});

function formatClockTime(value: string | Date): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return formatClockTimeMillis(parsed);
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
