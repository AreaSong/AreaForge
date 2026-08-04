"use client";

import { ArrowLeft, CloudOff, ExternalLink, Timer, Wifi } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getTimerElapsedSeconds } from "@areaforge/core";
import { getClientDeviceIdentity } from "@/lib/client/device-identity";
import { getNavigationTrail, sanitizeReturnPath } from "@/lib/navigation/batch7";
import type { StudySessionDto } from "@/lib/study/types";

const RECENT_PAGE_KEY = "af.navigation.previous";

type PreviousPage = { href: string; label: string } | null;
const previousPageListeners = new Set<() => void>();
let previousPageSnapshot: PreviousPage = null;
const serverNowSnapshot = new Date(0);
let nowSnapshot = new Date();
let nowTimer: number | null = null;
const nowListeners = new Set<() => void>();

function subscribeNow(listener: () => void): () => void {
  nowListeners.add(listener);
  if (nowTimer === null && typeof window !== "undefined") {
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
    raw = window.localStorage.getItem(RECENT_PAGE_KEY);
  } catch {
    previousPageSnapshot = null;
  }
  const previousTrail = raw && raw !== current ? getNavigationTrail(getPathname(raw)) : [];
  const previous = previousTrail.at(-1);
  previousPageSnapshot = previous ? { href: raw as string, label: previous.label } : null;
  try {
    window.localStorage.setItem(RECENT_PAGE_KEY, current);
  } catch {
    // The toolbar remains usable without a recent-page hint.
  }
  for (const listener of previousPageListeners) listener();
}

export function SharedStudyToolbar(props: {
  pathname: string;
  currentHref?: string;
  activeSession: StudySessionDto | null;
  syncState: "current" | "offline" | "unavailable";
}) {
  const now = useSyncExternalStore(
    subscribeNow,
    getNowSnapshot,
    getServerNowSnapshot,
  );
  const deviceId = useSyncExternalStore(
    () => () => undefined,
    () => getClientDeviceIdentity().id,
    () => null,
  );
  const previousPage = useSyncExternalStore(
    subscribePreviousPage,
    getPreviousPageSnapshot,
    getServerPreviousPageSnapshot,
  );
  const currentHref = props.currentHref ?? props.pathname;
  const trail = useMemo(() => getNavigationTrail(props.pathname), [props.pathname]);
  const showCurrentPage = trail.at(-1)?.label !== "开始学习";

  useEffect(() => {
    publishPreviousPage(currentHref);
  }, [currentHref]);

  const active = props.activeSession;
  const navigationLocked = active?.status === "closing";
  const elapsed = active ? getTimerElapsedSeconds({
    status: active.status === "running" ? "running" : active.status === "paused" ? "paused" : "completed",
    startedAt: new Date(active.startedAt),
    pausedAt: active.pausedAt ? new Date(active.pausedAt) : undefined,
    endedAt: active.endedAt ? new Date(active.endedAt) : undefined,
    accumulatedPauseSeconds: active.accumulatedPauseSeconds,
    now,
  }) : 0;
  const syncLabel = props.syncState === "offline" ? "离线" : props.syncState === "unavailable" ? "同步异常" : "已同步";
  const otherDevices = useMemo(() => {
    if (!active) return [];
    return active.devicePresences.filter((presence) => !deviceId || presence.deviceId !== deviceId);
  }, [active, deviceId]);
  const fallbackSourceDevice = active?.clientDeviceId && deviceId && active.clientDeviceId !== deviceId
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

  return (
    <div className="af-shared-toolbar shrink-0 border-t border-white/10 bg-[var(--af-surface-subtle)] px-4 py-2 text-xs sm:px-6 xl:px-8" data-global-ai-ui="true">
      <div className="mx-auto flex min-w-0 max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2">
        {active ? (
          <Link href={`/focus`} className="inline-flex min-w-0 items-center gap-2 text-teal-200 hover:text-teal-100" title="回到当前唯一活动计时">
            <Timer size={14} aria-hidden="true" />
            <span className="max-w-32 truncate">{active.subjectName}</span>
            <span className="font-mono tabular-nums">{formatDuration(elapsed)}</span>
            <span className="text-zinc-500">{active.status === "running" ? "学习中" : active.status === "paused" ? "已暂停" : "待收口"}</span>
          </Link>
        ) : (
          <Link href="/focus" className="inline-flex items-center gap-2 text-zinc-400 hover:text-teal-200" title="开始一段没有预设时长的学习">
            <Timer size={14} aria-hidden="true" />开始学习
          </Link>
        )}
        {active ? (
          <span
            className={`inline-flex min-w-0 items-center gap-1.5 ${otherDeviceOnline || fallbackSourceDeviceOnline ? "text-amber-200" : "text-zinc-500"}`}
            role="status"
            title={otherDevices.length > 0 ? `其他设备：${otherDevices.map((presence) => presence.deviceLabel).join("、")}` : fallbackSourceDevice ? `活动来自${fallbackSourceDevice}` : "活动来自当前设备"}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${otherDeviceOnline || fallbackSourceDeviceOnline ? "bg-amber-300" : "bg-zinc-600"}`} aria-hidden="true" />
            <span className="max-w-40 truncate">
              {presenceText}
            </span>
          </span>
        ) : null}
        {showCurrentPage ? (
          <>
            <span className="hidden h-4 w-px bg-white/10 sm:block" aria-hidden="true" />
            <span className="inline-flex min-w-0 items-center gap-1.5 text-zinc-500" title="当前内容页">
              <span className="hidden text-zinc-600 sm:inline">当前</span>
              <span className="max-w-48 truncate text-zinc-300">{trail.at(-1)?.label ?? "工作台"}</span>
            </span>
          </>
        ) : null}
        {previousPage && previousPage.href !== currentHref && !navigationLocked ? (
          <Link href={previousPage.href} className="inline-flex min-w-0 items-center gap-1.5 text-zinc-500 hover:text-zinc-200" title="返回刚才的页面">
            <ArrowLeft size={13} aria-hidden="true" />
            <span className="max-w-40 truncate">刚才：{previousPage.label}</span>
          </Link>
        ) : null}
        {navigationLocked ? (
          <span className="inline-flex items-center gap-1.5 text-amber-200" role="status">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-300" aria-hidden="true" />
            收口完成前暂不离开
          </span>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-1.5 text-zinc-500" role="status" aria-live="polite">
          {props.syncState === "current" ? <Wifi size={13} aria-hidden="true" /> : <CloudOff size={13} aria-hidden="true" />}
          {syncLabel}
        </span>
        <Link href={props.activeSession ? `/focus` : "/focus"} className="hidden items-center gap-1 text-zinc-600 hover:text-zinc-300 sm:inline-flex" title="打开开始学习">
          <ExternalLink size={12} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

function getPathname(value: string): string {
  try {
    return new URL(value, "https://areaforge.invalid").pathname;
  } catch {
    return value.split("?", 1)[0].split("#", 1)[0];
  }
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remaining = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}
