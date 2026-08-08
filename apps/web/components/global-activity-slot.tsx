"use client";

import { BookOpen, ClipboardCheck, FileCheck2, Repeat2, Timer } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { getTimerElapsedSeconds } from "@areaforge/core";
import { isLocalFocusSessionId } from "@/lib/client/focus-offline-store";
import { activityLabel, activitySourcePath } from "@/lib/study/activity-route";
import type { QuickReviewActivityClaim } from "@/lib/client/quick-review-activity";
import type { StudySessionDto } from "@/lib/study/types";

const serverNowSnapshot = 0;
// Keep the first client snapshot identical to the server snapshot. The real
// clock is installed once the external-store subscription is mounted.
let nowSnapshot = serverNowSnapshot;
let nowTimer: number | null = null;
const nowListeners = new Set<() => void>();

function subscribeNow(listener: () => void): () => void {
  nowListeners.add(listener);
  if (nowTimer === null && typeof window !== "undefined") {
    nowSnapshot = Date.now();
    listener();
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
  interactive?: boolean;
}) {
  const now = useSyncExternalStore(subscribeNow, getNowSnapshot, getServerNowSnapshot);
  const activity = getActivity(props.activeSession, props.offlineSession, props.quickReviewClaim, now);
  const interactive = props.interactive ?? true;

  return (
    <span className="flex min-w-0 justify-center" aria-live="polite">
      {activity ? (
        interactive ? (
          <Link
            href={activity.href}
            className={`inline-flex h-9 min-w-0 max-w-full items-center gap-1.5 rounded-md border px-2 text-xs hover:bg-white/[0.06] sm:min-w-[13rem] sm:gap-2 sm:px-3 ${activity.themeClass}`}
            aria-label={`${activity.kindLabel}：${activity.subjectLabel}，${formatDuration(activity.elapsedSeconds)}，${activity.statusLabel}`}
            title="打开当前唯一活动"
          >
            <ActivityContent activity={activity} />
          </Link>
        ) : (
          <span className={`inline-flex h-9 min-w-0 max-w-full items-center gap-1.5 border-transparent px-0 text-xs sm:min-w-[13rem] sm:justify-center sm:gap-2 sm:px-3 ${activity.themeClass}`}>
            <ActivityContent activity={activity} />
          </span>
        )
      ) : (
        <span className="inline-flex h-9 min-w-0 items-center gap-1.5 rounded-md border border-white/10 px-2 text-xs text-zinc-600 sm:min-w-[13rem] sm:justify-center sm:px-3">
          <Timer size={14} aria-hidden="true" />
          <span className="hidden sm:inline">当前没有活动计时</span>
          <span className="sm:hidden">未计时</span>
        </span>
      )}
    </span>
  );
}

function ActivityContent({ activity }: { activity: Activity }) {
  return (
    <>
      <activity.Icon size={15} className={`shrink-0 ${activity.iconClass}`} aria-hidden="true" />
      <span className="hidden max-w-20 truncate sm:inline">{activity.kindLabel}</span>
      <span className="max-w-24 truncate text-zinc-200 sm:max-w-32">{activity.subjectLabel}</span>
      <span className="font-mono tabular-nums text-teal-200">{formatDuration(activity.elapsedSeconds)}</span>
      <span className="hidden text-zinc-500 sm:inline">{activity.statusLabel}</span>
    </>
  );
}

type Activity = {
  href: string;
  kindLabel: string;
  subjectLabel: string;
  statusLabel: string;
  elapsedSeconds: number;
  Icon: typeof Timer;
  iconClass: string;
  themeClass: string;
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
      href: activitySourcePath(activeSession),
      kindLabel: activityLabel(activeSession),
      subjectLabel: activeSession.subjectName,
      statusLabel: activeSession.status === "running" ? "进行中" : activeSession.status === "paused" ? "已暂停" : "待收口",
      elapsedSeconds,
      Icon: activityIcon(activeSession),
      iconClass: activityIconClass(activeSession),
      themeClass: activityTheme(activeSession),
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
      iconClass: "text-teal-300",
      themeClass: "border-teal-300/35 bg-teal-300/[0.06] text-teal-100",
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
    iconClass: "text-sky-300",
    themeClass: "border-sky-300/35 bg-sky-300/[0.06] text-sky-100",
  };
}

function activityIcon(session: StudySessionDto): typeof Timer {
  if (session.activityMode === "SIMULATION") return FileCheck2;
  if (session.activityMode === "RETEST") return ClipboardCheck;
  if (session.activityMode === "KNOWLEDGE_REVIEW") return Repeat2;
  return BookOpen;
}

function activityIconClass(session: StudySessionDto): string {
  if (session.activityMode === "SIMULATION") return "text-amber-300";
  if (session.activityMode === "RETEST") return "text-orange-300";
  if (session.activityMode === "KNOWLEDGE_REVIEW") return "text-sky-300";
  return "text-teal-300";
}

function activityTheme(session: StudySessionDto): string {
  if (session.activityMode === "SIMULATION") return "border-amber-300/40 bg-amber-300/[0.08] text-amber-100";
  if (session.activityMode === "RETEST") return "border-orange-300/40 bg-orange-300/[0.08] text-orange-100";
  if (session.activityMode === "KNOWLEDGE_REVIEW") return "border-sky-300/40 bg-sky-300/[0.08] text-sky-100";
  return "border-teal-300/35 bg-teal-300/[0.06] text-teal-100";
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remaining = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}
