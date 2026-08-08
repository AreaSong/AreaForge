"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildForegroundNotificationPayload,
  evaluateAutomaticMotivationGate,
  sanitizeForegroundNotificationRoute,
  selectMobileTopLight,
  selectForegroundNotifications,
} from "@areaforge/core";
import { GlobalRecoveryHelp } from "@/components/global-recovery-help";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import {
  MOTIVATION_REMINDER_PREFERENCE_EVENT,
  motivationReminderPreferenceKey,
  readMotivationReminderPreference,
} from "@/lib/client/motivation-reminder-preference";
import {
  subscribeQuickReviewActivity,
  type QuickReviewActivityClaim,
} from "@/lib/client/quick-review-activity";
import {
  isLocalFocusSessionId,
  readFocusOfflineSnapshot,
  subscribeFocusOfflineSync,
  syncFocusOfflineQueue,
} from "@/lib/client/focus-offline-store";
import { getClientDeviceHeaders } from "@/lib/client/device-identity";
import { GlobalSessionCloseout } from "@/components/global-session-closeout";
import { useWindowSystem } from "@/components/window-system";
import { WorkbenchBreadcrumbActions } from "@/components/workbench-breadcrumb-actions";
import { GlobalContextStatusBar } from "@/components/shared-study-toolbar";
import { GlobalTopBar } from "@/components/global-top-bar";
import { PageToolbar } from "@/components/page-toolbar";
import { PrimaryNavigation } from "@/components/primary-navigation";
import { SecondaryNavigation } from "@/components/secondary-navigation";
import { SharedMobileNavigation } from "@/components/shared-mobile-navigation";
import { subscribeActivityStatus } from "@/lib/client/activity-status";
import { activityLabel, activitySourcePath } from "@/lib/study/activity-route";
import { BATCH10_NAV_ITEMS } from "@/lib/navigation/batch7";
import type { AppShellStatusDto } from "@/lib/study/app-shell-service";

const toneClass: Record<string, string> = {
  gray: "border-zinc-600 text-zinc-400",
  blue: "border-sky-400/50 text-sky-200",
  green: "border-emerald-400/50 text-emerald-200",
  amber: "border-amber-400/50 text-amber-200",
  red: "border-red-400/50 text-red-200",
};

type ShellSyncState = "current" | "pending" | "offline" | "blocked" | "deferred" | "unavailable";

export function AppShell(props: {
  children: React.ReactNode;
  initialStatus: AppShellStatusDto;
  email: string;
  userId: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState(props.initialStatus);
  const [syncState, setSyncState] = useState<ShellSyncState>("current");
  const [motivationDrawerSource, setMotivationDrawerSource] = useState<"manual" | "automatic">("manual");
  const [lightOpen, setLightOpen] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [motivationLine, setMotivationLine] = useState<string | null>(null);
  const [motivationUrl, setMotivationUrl] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [secondaryCollapsed, setSecondaryCollapsed] = useState(false);
  const [quickReviewClaim, setQuickReviewClaim] = useState<QuickReviewActivityClaim | null>(null);
  const [offlineFocusSession, setOfflineFocusSession] = useState<AppShellStatusDto["activeSession"]>(null);
  const { openWindow } = useWindowSystem();
  const serverActiveSessionRef = useRef<AppShellStatusDto["activeSession"]>(props.initialStatus.activeSession);
  const statusRefreshRevisionRef = useRef(0);
  const immersive = pathname.endsWith("/run");
  const fullCanvasPage = !immersive && (pathname === "/focus" || pathname === "/knowledge/canvas" || pathname.endsWith("/preview"));
  const suppressDistractions = immersive || pathname === "/focus";
  const currentHref = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
  const activeNavigationItem = BATCH10_NAV_ITEMS.find((item) => item.match(pathname));
  const secondaryNavigationItems = activeNavigationItem?.children ?? [];
  const showSecondaryNavigation = secondaryNavigationItems.length > 0;
  const displaySession = status.activeSession ?? offlineFocusSession;
  const displayStatus = projectLocalFocusStatus(projectLocalQuickReviewStatus(status, quickReviewClaim), displaySession);
  const activeSessionId = status.activeSession?.id;
  const activeSessionStatus = status.activeSession?.status;
  const currentActivitySession = status.activeSession ?? offlineFocusSession;

  const refreshShellStatus = useCallback(async () => {
    const revision = ++statusRefreshRevisionRef.current;
    try {
      const response = await fetch("/api/app-shell/status", { headers: getClientDeviceHeaders(), cache: "no-store" });
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) throw new Error("APP_SHELL_STATUS_UNAVAILABLE");
      const body = (await response.json()) as { status: AppShellStatusDto };
      if (revision !== statusRefreshRevisionRef.current) return;
      serverActiveSessionRef.current = body.status.activeSession;
      setStatus(body.status);
      if (body.status.activeSession) {
        // 服务端活动是权威状态，不能被过期的本地展示快照覆盖。
        setOfflineFocusSession(null);
      }
      setSyncState((current) => current === "pending" || current === "blocked" || current === "deferred" ? current : "current");
    } catch {
      if (revision === statusRefreshRevisionRef.current) {
        setSyncState(navigator.onLine ? "unavailable" : "offline");
      }
    }
  }, []);

  useEffect(() => subscribeQuickReviewActivity(props.userId, setQuickReviewClaim), [props.userId]);

  useEffect(() => {
    let cancelled = false;
    const refreshOfflineSession = async () => {
      const snapshot = await readFocusOfflineSnapshot(props.userId);
      const session = snapshot?.session && isRenderableFocusSession(snapshot.session)
        && (isLocalFocusSessionId(snapshot.session.id) || !navigator.onLine)
        ? snapshot.session
        : null;
      if (cancelled) return;
      // A server result wins over an earlier local read. This prevents a slow
      // IndexedDB callback from resurrecting an activity that the server has
      // already replaced or completed.
      if (serverActiveSessionRef.current !== null) {
        setOfflineFocusSession(null);
        return;
      }
      setOfflineFocusSession(session);
      if (snapshot && snapshot.syncState !== "current") setSyncState(toShellSyncState(snapshot.syncState));
    };
    void refreshOfflineSession();
    const onConnectivityChange = () => void refreshOfflineSession();
    window.addEventListener("online", onConnectivityChange);
    window.addEventListener("offline", onConnectivityChange);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onConnectivityChange);
      window.removeEventListener("offline", onConnectivityChange);
    };
  }, [props.userId]);

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      void syncFocusOfflineQueue(props.userId).then((result) => {
        if (!cancelled) setSyncState(toShellSyncState(result.state));
      }).catch(() => {
        if (!cancelled) setSyncState(navigator.onLine ? "unavailable" : "offline");
      });
    };
    sync();
    window.addEventListener("online", sync);
    const interval = window.setInterval(sync, 15_000);
    return () => {
      cancelled = true;
      window.removeEventListener("online", sync);
      window.clearInterval(interval);
    };
  }, [props.userId]);

  useEffect(() => {
    const unsubscribe = subscribeFocusOfflineSync((event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; state?: string; session?: AppShellStatusDto["activeSession"] | null }>).detail;
      if (detail?.userId !== props.userId || detail.session === undefined) return;
      if (detail.state) setSyncState(toShellSyncState(detail.state));
      const session = detail.session;
      if (session && isLocalFocusSessionId(session.id)) {
        if (serverActiveSessionRef.current !== null) return;
        setOfflineFocusSession(isRenderableFocusSession(session) ? session : null);
        return;
      }
      if (!session) {
        if (serverActiveSessionRef.current !== null) return;
        void readRenderableOfflineFocusSession(props.userId).then((localSession) => {
          if (serverActiveSessionRef.current === null) setOfflineFocusSession(localSession);
        });
        return;
      }
      serverActiveSessionRef.current = isRenderableFocusSession(session) ? session : null;
      setOfflineFocusSession(null);
      setStatus((current) => ({
        ...current,
        activeSession: isRenderableFocusSession(session)
          ? session
          : null,
      }));
    });
    return unsubscribe;
  }, [props.userId]);

  useEffect(() => {
    const unsubscribe = subscribeActivityStatus((event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; session?: AppShellStatusDto["activeSession"] | null }>).detail;
      if (detail?.userId !== props.userId || detail.session === undefined) return;
      const session = detail.session && isRenderableFocusSession(detail.session) ? detail.session : null;
      serverActiveSessionRef.current = session;
      setStatus((current) => ({ ...current, activeSession: session }));
      if (session) {
        setOfflineFocusSession(null);
      } else {
        // An activity completion event must clear the derived activity light as
        // well as the session slot; the next server projection supplies any
        // just-completed or recovery state that may apply.
        setStatus((current) => ({
          ...current,
          activeSession: null,
          lights: current.lights.map((light) => light.kind === "activity"
            ? { ...light, tone: "gray", summary: "无活动", action: null }
            : light),
          mobileTop: selectMobileTopLight(current.lights.map((light) => light.kind === "activity"
            ? { ...light, tone: "gray", summary: "无活动", action: null }
            : light)),
        }));
        setOfflineFocusSession(null);
      }
      void refreshShellStatus();
    });
    return unsubscribe;
  }, [props.userId, refreshShellStatus]);

  useEffect(() => {
    if (!activeSessionId || (activeSessionStatus !== "running" && activeSessionStatus !== "paused" && activeSessionStatus !== "closing")) return;
    let cancelled = false;
    const heartbeat = async () => {
      try {
        const response = await fetch(`/api/study-sessions/${encodeURIComponent(activeSessionId)}/heartbeat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getClientDeviceHeaders() },
          body: "{}",
          cache: "no-store",
        });
        const body = await response.json().catch(() => null) as { session?: AppShellStatusDto["activeSession"] } | null;
        if (!cancelled && response.ok && body && body.session !== undefined) {
          serverActiveSessionRef.current = body.session ?? null;
          setStatus((current) => ({ ...current, activeSession: body.session ?? null }));
        }
      } catch {
        // The shell's status refresh remains the fallback when the heartbeat is unavailable.
      }
    };
    void heartbeat();
    const interval = window.setInterval(heartbeat, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeSessionId, activeSessionStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSidebarCollapsed(readLocalStorage("af.sidebar.collapsed") === "1");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSecondaryCollapsed(readLocalStorage("af.sidebar.secondary.collapsed") === "1");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!lightOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightOpen]);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      writeLocalStorage("af.sidebar.collapsed", next ? "1" : "0");
      return next;
    });
  }

  function toggleSecondary() {
    setSecondaryCollapsed((current) => {
      const next = !current;
      writeLocalStorage("af.sidebar.secondary.collapsed", next ? "1" : "0");
      return next;
    });
  }

  function openStatusLight() {
    setLightOpen((current) => !current);
  }

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (!cancelled) void refreshShellStatus();
    };
    const onOnline = () => refresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60_000);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pathname, refreshShellStatus]);

  useEffect(() => {
    if (suppressDistractions || document.visibilityState !== "visible" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    const shanghaiNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const categories = selectForegroundNotifications({
      hour: shanghaiNow.getUTCHours(),
      preference: status.notificationPreference,
      candidates: status.notificationCandidates,
    });
    const date = shanghaiNow.toISOString().slice(0, 10);
    const category = categories.find((candidate) => {
      const key = `af.notification.sent.${status.workspaceId ?? "setup"}.${date}.${candidate}`;
      return readLocalStorage(key) !== "1";
    });
    if (!category) return;
    const dedupeKey = `af.notification.sent.${status.workspaceId ?? "setup"}.${date}.${category}`;
    const payload = buildForegroundNotificationPayload(category);
    const showSpecificTitle = readLocalStorage("af.notification.showSpecificTitle") === "1";
    const notification = new Notification(showSpecificTitle ? payload.title : "AreaForge 提醒", {
      body: payload.body,
      tag: payload.tag,
      data: payload.data,
    });
    writeLocalStorage(dedupeKey, "1");
    notification.onclick = () => {
      window.focus();
      router.push(sanitizeForegroundNotificationRoute(payload.data.route));
      notification.close();
    };
  }, [suppressDistractions, router, status]);

  useEffect(() => {
    if (suppressDistractions || !status.workspaceId) return;
    let cancelled = false;
    const cooldownKey = `af.motivation.auto.next.${status.workspaceId}`;

    async function showAutomaticReminder() {
      const preference = readMotivationReminderPreference(props.userId);
      const shanghaiNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
      const clientGate = evaluateAutomaticMotivationGate({
        enabled: preference.enabled,
        hour: shanghaiNow.getUTCHours(),
        windowStart: preference.windowStart,
        windowEnd: preference.windowEnd,
        visible: document.visibilityState === "visible",
        immersive: suppressDistractions,
        hasActiveActivity: status.motivationReminderCandidate.blockedByActiveActivity,
        trigger: status.motivationReminderCandidate.trigger,
      });
      if (!clientGate.allowed) return;
      const nextEligibleAt = Number(readLocalStorage(cooldownKey) ?? "0");
      if (Number.isFinite(nextEligibleAt) && nextEligibleAt > Date.now()) return;

      try {
        const response = await fetch("/api/motivation/next", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "automatic" }),
        });
        const body = (await response.json().catch(() => null)) as
          | { item?: { title?: string; body?: string | null; externalUrl?: string | null } | null; reminderAllowed?: boolean }
          | null;
        if (!response.ok || cancelled) return;

        // The server is authoritative for the four-hour and daily limits. A local
        // cooldown avoids repeated fetches during ordinary route changes.
        const cooldown = body?.reminderAllowed ? 4 * 60 * 60 * 1000 : 15 * 60 * 1000;
        writeLocalStorage(cooldownKey, String(Date.now() + cooldown));
        if (!body?.reminderAllowed || !body.item) return;

        setRecoveryError(null);
        setMotivationLine(body.item.body ?? body.item.title ?? null);
        setMotivationUrl(body.item.externalUrl ?? null);
        setMotivationDrawerSource("automatic");
        openWindow("recovery-help");
      } catch {
        // An automatic reminder must never interrupt the current page on failure.
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void showAutomaticReminder();
    };
    const onPreferenceChange = () => void showAutomaticReminder();
    const onStorage = (event: StorageEvent) => {
      if (event.key === motivationReminderPreferenceKey(props.userId)) void showAutomaticReminder();
    };
    void showAutomaticReminder();
    const interval = window.setInterval(() => void showAutomaticReminder(), 60_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener(MOTIVATION_REMINDER_PREFERENCE_EVENT, onPreferenceChange);
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener(MOTIVATION_REMINDER_PREFERENCE_EVENT, onPreferenceChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [openWindow, suppressDistractions, props.userId, status.motivationReminderCandidate, status.workspaceId]);

  async function openMotivationHelp() {
    setRecoveryError(null);
    setMotivationLine(null);
    setMotivationUrl(null);
    setMotivationDrawerSource("manual");
    openWindow("recovery-help");
    try {
      const response = await fetch("/api/motivation/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "manual" }),
      });
      const body = (await response.json().catch(() => null)) as
        | { item?: { title?: string; body?: string | null; externalUrl?: string | null }; error?: string }
        | null;
      if (!response.ok) {
        setRecoveryError(body?.error ?? "无法加载动机内容");
        return;
      }
      if (body?.item) {
        const line = body.item.body ?? body.item.title ?? null;
        setMotivationLine(line);
        setMotivationUrl(body.item.externalUrl ?? null);
      } else {
        setMotivationLine("内容库为空。可到设置 → 档案添加语录。");
      }
    } catch {
      setRecoveryError("无法加载动机内容");
    }
  }

  if (immersive) {
    return (
      <main className="flex min-h-screen flex-col bg-[#080b0f] text-zinc-100">
        <PageToolbar />
        <div className="min-h-0 flex-1" data-layout-region="immersive-content">{props.children}</div>
        <GlobalContextStatusBar pathname={pathname} currentHref={currentHref} activeSession={currentActivitySession} statusLights={displayStatus.lights} syncState={syncState} serverTime={status.serverTime} />
      </main>
    );
  }

  return (
    <div className="af-app-shell h-dvh overflow-hidden bg-[var(--af-canvas)] text-zinc-100" data-layout-region="app-shell">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[1000] focus:inline-flex focus:h-10 focus:items-center focus:rounded-md focus:bg-teal-300 focus:px-3 focus:text-sm focus:font-medium focus:text-slate-950"
      >
        跳到主要内容
      </a>
      <div className="flex h-full w-full">
        <PrimaryNavigation pathname={pathname} collapsed={sidebarCollapsed} email={props.email} userId={props.userId} onToggle={toggleSidebar} />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <GlobalTopBar
            pathname={pathname}
            userId={props.userId}
            statusTone={displayStatus.mobileTop.tone}
            statusSummary={displayStatus.mobileTop.summary}
            activeSession={status.activeSession}
            offlineSession={offlineFocusSession}
            quickReviewClaim={quickReviewClaim}
            onOpenStatus={openStatusLight}
            statusOpen={lightOpen}
            onOpenMotivationHelp={() => void openMotivationHelp()}
          />
          {showSecondaryNavigation && activeNavigationItem ? (
            <nav className="shrink-0 overflow-x-auto px-4 pt-3 pb-1 sm:px-6 xl:px-8 lg:hidden" aria-label={`${activeNavigationItem.label}子导航`} data-layout-region="secondary-mobile-navigation">
              <div className="flex min-w-max gap-2 whitespace-nowrap">
                {secondaryNavigationItems.map((child) => (
                  <Link
                    key={child.href}
                    href={child.href}
                    aria-current={pathname === child.href ? "page" : child.match(pathname) ? "location" : undefined}
                    className={`rounded-md border px-3 py-1.5 text-xs ${child.match(pathname) ? "border-teal-400/50 text-teal-200" : "border-white/10 text-zinc-400"}`}
                  >
                    {child.label}
                  </Link>
                ))}
              </div>
            </nav>
          ) : null}
          <PageToolbar>
            <WorkbenchBreadcrumbActions pathname={pathname} currentHref={currentHref} />
          </PageToolbar>

          <div className="flex min-h-0 min-w-0 flex-1">
            {showSecondaryNavigation && activeNavigationItem ? <SecondaryNavigation pathname={pathname} workbench={activeNavigationItem} collapsed={secondaryCollapsed} onToggle={toggleSecondary} /> : null}

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <main
                id="main-content"
                className={`af-shell-main min-h-0 flex-1 ${fullCanvasPage ? "overflow-y-auto" : "overflow-y-auto px-4 py-5 sm:px-6 xl:px-8 xl:py-6"}`}
                data-ai-page-context="true"
                data-layout-region="page-content"
              >{props.children}</main>
            </div>
          </div>

          <GlobalContextStatusBar pathname={pathname} currentHref={currentHref} activeSession={currentActivitySession} statusLights={displayStatus.lights} syncState={syncState} serverTime={status.serverTime} />

          <SharedMobileNavigation pathname={pathname} />
        </div>
      </div>

      <GlobalRecoveryHelp
        title={motivationDrawerSource === "automatic" ? "行动提醒" : "我学不下去了"}
        motivationLine={motivationLine}
        motivationUrl={motivationUrl}
        motivationError={recoveryError}
        workspaceId={status.workspaceId}
        defaultSubjectId={status.defaultSubjectId}
        onClose={() => undefined}
      />
      <GlobalSessionCloseout
        userId={props.userId}
        activeSession={currentActivitySession}
        returnTo={currentHref}
        initialNow={status.serverTime}
        pathname={pathname}
      />
      {lightOpen ? (
        <div className="fixed inset-0 z-[70] grid place-items-start bg-black/40 p-4 pt-20" role="presentation" onClick={() => setLightOpen(false)}>
          <section className="w-full max-w-md rounded-lg border border-white/15 bg-[#101419] p-5 shadow-2xl" role="dialog" aria-modal="false" aria-label="今日状态" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold text-white">今日状态</h2><button type="button" className="text-sm text-zinc-400 hover:text-white" onClick={() => setLightOpen(false)}>关闭</button></div>
            <div className="divide-y divide-white/10" aria-label="今日状态详情">
              {displayStatus.lights.map((light) => (
                <div key={light.kind} className="py-4 first:pt-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full border ${toneClass[light.tone] ?? toneClass.gray}`} aria-hidden="true" />
                    <p className="text-sm font-medium text-zinc-200">{light.label}</p>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-zinc-500">{light.summary}</p>
                  {light.action ? (
                    <Link href={light.action.href} className="mt-2 inline-flex text-sm text-teal-300 hover:underline" onClick={() => setLightOpen(false)}>
                      {light.action.label}
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function projectLocalQuickReviewStatus(
  status: AppShellStatusDto,
  claim: QuickReviewActivityClaim | null,
): Pick<AppShellStatusDto, "lights" | "mobileTop"> {
  if (!claim) return status;
  const lights = status.lights.map((light) => light.kind === "review"
    ? {
        ...light,
        tone: "blue" as const,
        summary: "正在快速复习",
        action: { label: "继续复习", href: claim.href },
      }
    : light);
  return { lights, mobileTop: selectMobileTopLight(lights) };
}

function projectLocalFocusStatus(
  status: Pick<AppShellStatusDto, "lights" | "mobileTop">,
  session: AppShellStatusDto["activeSession"],
): Pick<AppShellStatusDto, "lights" | "mobileTop"> {
  if (!session) return status;
  const lights = status.lights.map((light) => light.kind === "activity"
    ? {
        ...light,
        tone: session.status === "closing" ? "amber" as const : session.status === "paused" ? "blue" as const : "green" as const,
        summary: session.status === "closing" ? `${activityLabel(session)}已冻结，等待收口` : session.status === "paused" ? `${activityLabel(session)}已暂停，可继续` : `正在${activityLabel(session)}`,
        action: { label: session.status === "closing" ? "完成收口" : `继续${activityLabel(session)}`, href: activitySourcePath(session) },
      }
    : light);
  return { lights, mobileTop: selectMobileTopLight(lights) };
}

function isRenderableFocusSession(
  session: AppShellStatusDto["activeSession"],
): session is NonNullable<AppShellStatusDto["activeSession"]> {
  return Boolean(session && ["running", "paused", "closing"].includes(session.status));
}

async function readRenderableOfflineFocusSession(
  userId: string,
): Promise<AppShellStatusDto["activeSession"]> {
  const snapshot = await readFocusOfflineSnapshot(userId);
  const session = snapshot?.session ?? null;
  return isRenderableFocusSession(session) && (isLocalFocusSessionId(session.id) || !navigator.onLine) ? session : null;
}

function toShellSyncState(value: string): ShellSyncState {
  if (value === "pending" || value === "offline" || value === "blocked" || value === "deferred") return value;
  return value === "unavailable" ? "unavailable" : "current";
}

function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Optional shell preferences must not block the main workflow.
  }
}
