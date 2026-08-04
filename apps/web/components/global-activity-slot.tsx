"use client";

import { BookOpen, Repeat2, Timer } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { getTimerElapsedSeconds } from "@areaforge/core";
import { isLocalFocusSessionId } from "@/lib/client/focus-offline-store";
import type { QuickReviewActivityClaim } from "@/lib/client/quick-review-activity";
import type { StudySessionDto } from "@/lib/study/types";

let nowSnapshot = Date.now();
const serverNowSnapshot = 0;
let nowTimer: number | null = null;
const nowListeners = new Set<() => void>();

function subscribeNow(listener: () => void): () => void {
  nowListeners.add(listener);
  if (nowTimer === null && typeof window !== "undefined") {
    nowTimer = window.setInterval(() => {
      nowSnapshot = Date.now();
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

function getNowSnapshot(): number {
  return nowSnapshot;
}

function getServerNowSnapshot(): number {
  return serverNowSnapshot;
}

export function GlobalActivitySlot(props: {
  activeSession: StudySessionDto | null;
  offlineSession: StudySessionDto | null;
  quickReviewClaim: QuickReviewActivityClaim | null;
}) {
  const now = useSyncExternalStore(subscribeNow, getNowSnapshot, getServerNowSnapshot);
  const activity = getActivity(props.activeSession, props.offlineSession, props.quickReviewClaim, now);

  return (
    <div className="flex min-w-0 justify-center" aria-live="polite">
      {activity ? (
        <Link
          href={activity.href}
          className="inline-flex h-9 min-w-0 max-w-full items-center gap-1.5 rounded-md border border-teal-300/35 bg-teal-300/[0.06] px-2 text-xs text-teal-100 hover:border-teal-300/60 hover:bg-teal-300/[0.1] sm:min-w-[13rem] sm:gap-2 sm:px-3"
          aria-label={`${activity.kindLabel}：${activity.subjectLabel}，${formatDuration(activity.elapsedSeconds)}，${activity.statusLabel}`}
          title="打开当前唯一活动"
        >
          <activity.Icon size={15} className="shrink-0 text-teal-300" aria-hidden="true" />
          <span className="hidden max-w-20 truncate sm:inline">{activity.kindLabel}</span>
          <span className="max-w-24 truncate text-zinc-200 sm:max-w-32">{activity.subjectLabel}</span>
          <span className="font-mono tabular-nums text-teal-200">{formatDuration(activity.elapsedSeconds)}</span>
          <span className="hidden text-zinc-500 sm:inline">{activity.statusLabel}</span>
        </Link>
      ) : (
        <span className="inline-flex h-9 min-w-0 items-center gap-1.5 rounded-md border border-white/10 px-2 text-xs text-zinc-600 sm:min-w-[13rem] sm:justify-center sm:px-3">
          <Timer size={14} aria-hidden="true" />
          <span className="hidden sm:inline">当前没有活动计时</span>
          <span className="sm:hidden">未计时</span>
        </span>
      )}
    </div>
  );
}

type Activity = {
  href: string;
  kindLabel: string;
  subjectLabel: string;
  statusLabel: string;
  elapsedSeconds: number;
  Icon: typeof Timer;
};

function getActivity(
  activeSession: StudySessionDto | null,
  offlineSession: StudySessionDto | null,
  quickReviewClaim: QuickReviewActivityClaim | null,
  now: number,
): Activity | null {
  if (activeSession) {
    const elapsedSeconds = getTimerElapsedSeconds({
      status: activeSession.status === "running" ? "running" : activeSession.status === "paused" ? "paused" : "completed",
      startedAt: new Date(activeSession.startedAt),
      pausedAt: activeSession.pausedAt ? new Date(activeSession.pausedAt) : undefined,
      endedAt: activeSession.endedAt ? new Date(activeSession.endedAt) : undefined,
      accumulatedPauseSeconds: activeSession.accumulatedPauseSeconds,
      now: new Date(now),
    });
    return {
      href: "/focus",
      kindLabel: "学习",
      subjectLabel: activeSession.subjectName,
      statusLabel: activeSession.status === "running" ? "进行中" : activeSession.status === "paused" ? "已暂停" : "待收口",
      elapsedSeconds,
      Icon: BookOpen,
    };
  }
  if (offlineSession) {
    const statusLabel = offlineSession.status === "running" ? "进行中" : offlineSession.status === "paused" ? "已暂停" : "待收口";
    return {
      href: "/focus",
      kindLabel: "学习",
      subjectLabel: offlineSession.subjectName,
      statusLabel: `${statusLabel} · ${isLocalFocusSessionId(offlineSession.id) ? "待同步" : "离线"}`,
      elapsedSeconds: getTimerElapsedSeconds({
        status: offlineSession.status === "running" ? "running" : offlineSession.status === "paused" ? "paused" : "completed",
        startedAt: new Date(offlineSession.startedAt),
        pausedAt: offlineSession.pausedAt ? new Date(offlineSession.pausedAt) : undefined,
        endedAt: offlineSession.endedAt ? new Date(offlineSession.endedAt) : undefined,
        accumulatedPauseSeconds: offlineSession.accumulatedPauseSeconds,
        now: new Date(now),
      }),
      Icon: BookOpen,
    };
  }
  if (!quickReviewClaim) return null;
  return {
    href: quickReviewClaim.href,
    kindLabel: "复习",
    subjectLabel: "快速复习",
    statusLabel: quickReviewClaim.phase === "running" ? "进行中" : "待收口",
    elapsedSeconds: Math.max(0, Math.floor((now - quickReviewClaim.startedAt) / 1_000)),
    Icon: Repeat2,
  };
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remaining = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}
