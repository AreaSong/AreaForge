"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  BookOpen,
  BriefcaseBusiness,
  CalendarCheck2,
  ChartSpline,
  ClipboardCheck,
  FileCheck2,
  FilePlus2,
  Goal,
  Inbox,
  LayoutDashboard,
  ListTree,
  ListTodo,
  Milestone,
  MonitorCog,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Repeat2,
  Route,
  Settings,
  ScrollText,
  SlidersHorizontal,
  Sparkles,
  Timer,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  buildForegroundNotificationPayload,
  evaluateAutomaticMotivationGate,
  sanitizeForegroundNotificationRoute,
  selectMobileTopLight,
  selectForegroundNotifications,
} from "@areaforge/core";
import { BrandMark } from "@/components/brand-logo";
import { LogoutButton } from "@/components/logout-button";
import { RecoveryActionDrawer } from "@/components/recovery-action-drawer";
import { Drawer } from "@/components/ui/overlays";
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
import { GlobalAiAssistant } from "@/components/global-ai-assistant";
import { GlobalActivitySlot } from "@/components/global-activity-slot";
import { GlobalConfirmationCenter } from "@/components/global-confirmation-center";
import { WorkbenchBreadcrumb } from "@/components/workbench-breadcrumb";
import { WorkbenchBreadcrumbActions } from "@/components/workbench-breadcrumb-actions";
import { SharedStudyToolbar } from "@/components/shared-study-toolbar";
import { subscribeActivityStatus } from "@/lib/client/activity-status";
import { BATCH10_NAV_ITEMS, PRIMARY_WORKBENCH_ITEMS, UTILITY_NAV_ITEM } from "@/lib/navigation/batch7";
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
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [motivationDrawerSource, setMotivationDrawerSource] = useState<"manual" | "automatic">("manual");
  const [lightOpen, setLightOpen] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [motivationLine, setMotivationLine] = useState<string | null>(null);
  const [motivationUrl, setMotivationUrl] = useState<string | null>(null);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [secondaryCollapsed, setSecondaryCollapsed] = useState(false);
  const [quickReviewClaim, setQuickReviewClaim] = useState<QuickReviewActivityClaim | null>(null);
  const [offlineFocusSession, setOfflineFocusSession] = useState<AppShellStatusDto["activeSession"]>(null);
  const serverActiveSessionRef = useRef<AppShellStatusDto["activeSession"]>(props.initialStatus.activeSession);
  const immersive = pathname.endsWith("/run");
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
  const closeoutPath = currentActivitySession ? activityPath(currentActivitySession) : null;
  const outsideCloseout = currentActivitySession?.status === "closing" && closeoutPath !== null && pathname !== closeoutPath;

  useEffect(() => {
    if (!outsideCloseout || !closeoutPath) return;
    router.replace(closeoutPath);
  }, [closeoutPath, outsideCloseout, router]);

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
      if (session) setOfflineFocusSession(null);
    });
    return unsubscribe;
  }, [props.userId]);

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
    async function refresh() {
      try {
        const response = await fetch("/api/app-shell/status", { headers: getClientDeviceHeaders(), cache: "no-store" });
        if (response.status === 401) {
          redirectToLoginWithCurrentLocation();
          return;
        }
        if (!response.ok) throw new Error("APP_SHELL_STATUS_UNAVAILABLE");
        const body = (await response.json()) as { status: AppShellStatusDto };
        if (!cancelled) {
          serverActiveSessionRef.current = body.status.activeSession;
          setStatus(body.status);
          if (body.status.activeSession) {
            // 服务端活动是权威状态，不能被过期的本地展示快照覆盖。
            setOfflineFocusSession(null);
          }
          setSyncState((current) => current === "pending" || current === "blocked" || current === "deferred" ? current : "current");
        }
      } catch {
        if (!cancelled) setSyncState(navigator.onLine ? "unavailable" : "offline");
      }
    }
    const onOnline = () => void refresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
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
  }, [pathname]);

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
        setRecoveryOpen(true);
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
  }, [suppressDistractions, props.userId, status.motivationReminderCandidate, status.workspaceId]);

  async function openMotivationHelp() {
    setRecoveryError(null);
    setMotivationLine(null);
    setMotivationUrl(null);
    setMotivationDrawerSource("manual");
    setRecoveryOpen(true);
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
        <div className="min-h-0 flex-1">{props.children}</div>
        <SharedStudyToolbar pathname={pathname} currentHref={currentHref} activeSession={currentActivitySession} syncState={syncState} />
      </main>
    );
  }

  if (outsideCloseout && closeoutPath) {
    return (
      <main className="flex min-h-screen flex-col bg-[var(--af-canvas)] text-zinc-100">
        <section className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 px-6 py-16">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-amber-300">学习收口</p>
          <h1 className="text-2xl font-semibold text-white">这段学习还没有完成收口</h1>
          <p className="text-sm leading-6 text-zinc-400">计时已经冻结。完成收口或明确保留本次记录后，才能继续访问其他页面。</p>
          <Link href={closeoutPath} className="inline-flex h-11 w-fit items-center rounded-md bg-teal-300 px-4 text-sm font-medium text-slate-950 hover:bg-teal-200">
            返回学习收口
          </Link>
        </section>
        <SharedStudyToolbar pathname={pathname} currentHref={currentHref} activeSession={currentActivitySession} syncState={syncState} />
      </main>
    );
  }

  return (
    <div className="af-app-shell h-dvh overflow-hidden bg-[var(--af-canvas)] text-zinc-100">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[1000] focus:inline-flex focus:h-10 focus:items-center focus:rounded-md focus:bg-teal-300 focus:px-3 focus:text-sm focus:font-medium focus:text-slate-950"
      >
        跳到主要内容
      </a>
      <div className="flex h-full w-full">
          <aside
          aria-label="一级导航"
          data-navigation-level="primary"
            className={`hidden shrink-0 flex-col border-r border-white/10 bg-[var(--af-surface-subtle)] px-3 py-5 transition-[width] lg:flex ${sidebarCollapsed ? "w-[60px]" : "w-[184px]"}`}
        >
          <div className={`mb-6 flex items-center text-teal-300 ${sidebarCollapsed ? "justify-center" : "justify-between gap-2 px-2"}`}>
            <div className="flex min-w-0 items-center gap-2">
              <BrandMark size={22} />
              <span className={sidebarCollapsed ? "sr-only" : "truncate text-sm font-medium"}>AreaForge</span>
            </div>
            <button
              type="button"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white"
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? "展开侧栏" : "折叠侧栏"}
              title={sidebarCollapsed ? "展开侧栏" : "折叠侧栏"}
              aria-expanded={!sidebarCollapsed}
              aria-controls="primary-navigation"
            >
              {sidebarCollapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
            </button>
          </div>
          <nav id="primary-navigation" className="flex flex-col gap-1" aria-label="主导航">
            {PRIMARY_WORKBENCH_ITEMS.map((item) => {
              const active = item.match(pathname);
              const activeChild = item.children?.some((child) => child.match(pathname)) ?? false;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? (activeChild ? "location" : navigationAriaCurrent(pathname, item)) : undefined}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={`flex min-w-0 items-center rounded-md border-l-2 py-2 text-sm transition-colors ${sidebarCollapsed ? "justify-center px-2" : "gap-3 px-3"} ${active ? "border-teal-300 bg-white/[0.08] text-white" : "border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-100"}`}
                >
                  <NavigationIcon href={item.href} />
                  <span className={sidebarCollapsed ? "sr-only" : "truncate"}>{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className={`mt-auto space-y-2 pt-6 text-xs text-zinc-500 ${sidebarCollapsed ? "grid justify-items-center" : "px-2"}`}>
            <Link
              href={UTILITY_NAV_ITEM.href}
              aria-current={UTILITY_NAV_ITEM.match(pathname) ? "page" : undefined}
              title={sidebarCollapsed ? UTILITY_NAV_ITEM.label : undefined}
              className={`flex min-w-0 items-center rounded-md border-l-2 py-2 text-sm transition-colors ${sidebarCollapsed ? "justify-center px-2" : "gap-3 px-3"} ${UTILITY_NAV_ITEM.match(pathname) ? "border-teal-300 bg-white/[0.08] text-white" : "border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-100"}`}
            >
              <NavigationIcon href={UTILITY_NAV_ITEM.href} />
              <span className={sidebarCollapsed ? "sr-only" : "truncate"}>{UTILITY_NAV_ITEM.label}</span>
            </Link>
            <p className={sidebarCollapsed ? "sr-only" : undefined}>{props.email}</p>
            <LogoutButton compact={sidebarCollapsed} userId={props.userId} />
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="af-shell-header z-20 shrink-0 border-b border-white/10 bg-[color:var(--af-canvas)]/95 px-4 py-3 backdrop-blur sm:px-6 xl:px-8">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex shrink-0 items-center gap-2 lg:hidden">
                  <BrandMark size={20} />
                  <span className="hidden text-sm text-teal-300 min-[360px]:inline">AreaForge</span>
                </div>
                <button
                  type="button"
                  className="hidden h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 text-xs text-zinc-200 hover:bg-white/[0.07] md:inline-flex"
                  onClick={openStatusLight}
                  aria-label={`今日状态：${displayStatus.mobileTop.summary}`}
                  aria-expanded={lightOpen}
                >
                  <Activity size={15} className={toneClass[displayStatus.mobileTop.tone] ?? toneClass.gray} aria-hidden="true" />
                  <span>今日状态</span>
                  <span className="max-w-52 truncate text-zinc-500">{displayStatus.mobileTop.summary}</span>
                </button>
              </div>
              <div className="flex min-w-0 shrink-0 items-center justify-end gap-1 sm:col-start-3 sm:row-start-1 sm:gap-1.5">
                <button
                  type="button"
                  className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-2 text-xs md:hidden ${toneClass[displayStatus.mobileTop.tone] ?? toneClass.gray}`}
                  onClick={openStatusLight}
                  aria-label={`状态：${displayStatus.mobileTop.summary}`}
                  aria-expanded={lightOpen}
                >
                  <Activity size={15} aria-hidden="true" />
                  <span className="hidden min-[360px]:inline">状态</span>
                </button>
                <GlobalConfirmationCenter pathname={pathname} userId={props.userId} />
                <GlobalAiAssistant userId={props.userId} placement="header" />
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-zinc-300 hover:bg-white/5"
                  onClick={() => setQuickCreateOpen(true)}
                  aria-label="快捷创建"
                  title="快捷创建"
                >
                  <Plus size={17} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-2.5 text-xs text-zinc-300 hover:bg-white/5 sm:px-3"
                  onClick={() => void openMotivationHelp()}
                  aria-label="我学不下去了"
                  title="我学不下去了"
                >
                  <TriangleAlert size={16} aria-hidden="true" />
                  <span className="hidden sm:inline">我学不下去了</span>
                </button>
              </div>
              <div className="col-span-2 min-w-0 justify-self-center sm:col-span-1 sm:col-start-2 sm:row-start-1">
                <GlobalActivitySlot activeSession={status.activeSession} offlineSession={offlineFocusSession} quickReviewClaim={quickReviewClaim} />
              </div>
            </div>
            <p
              className={`${syncState === "current" ? "sr-only md:mt-2 md:block md:text-xs md:text-zinc-500" : "mt-2 text-xs text-amber-200"}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {syncState === "current"
                ? `状态同步于 ${formatServerTime(status.serverTime)}`
                : `${shellSyncStateLabel(syncState)}；显示上次服务端状态（${formatServerTime(status.serverTime)}）`}
            </p>
            {showSecondaryNavigation && activeNavigationItem ? (
              <nav className="mt-3 overflow-x-auto pb-1 lg:hidden" aria-label={`${activeNavigationItem.label}子导航`}>
                <div className="flex min-w-max gap-2 whitespace-nowrap">
                  {secondaryNavigationItems.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      aria-current={navigationAriaCurrent(pathname, child)}
                      className={`rounded-md border px-3 py-1.5 text-xs ${child.match(pathname) ? "border-teal-400/50 text-teal-200" : "border-white/10 text-zinc-400"}`}
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              </nav>
            ) : null}
            {!immersive ? (
              <WorkbenchBreadcrumb>
                <WorkbenchBreadcrumbActions pathname={pathname} />
              </WorkbenchBreadcrumb>
            ) : null}
          </header>

          <div className="flex min-h-0 min-w-0 flex-1">
            {showSecondaryNavigation && activeNavigationItem ? (
              <aside
                aria-label={`${activeNavigationItem.label}二级导航`}
                data-navigation-level="secondary"
                className={`hidden min-h-0 shrink-0 flex-col border-r border-white/[0.07] bg-[var(--af-surface-subtle)]/45 py-5 transition-[width] lg:flex ${secondaryCollapsed ? "w-[52px] px-1.5" : "w-[216px] px-3"}`}
              >
                <div className={`mb-5 flex items-center ${secondaryCollapsed ? "justify-center" : "justify-between gap-2 px-2"}`}>
                  <div className={secondaryCollapsed ? "sr-only" : "min-w-0 border-l-2 border-teal-300/40 pl-2 text-xs font-medium text-zinc-500"}>
                    <span className="truncate">{activeNavigationItem.label}内容</span>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
                    onClick={toggleSecondary}
                    aria-label={secondaryCollapsed ? "展开二级导航" : "收起二级导航"}
                    title={secondaryCollapsed ? "展开二级导航" : "收起二级导航"}
                    aria-expanded={!secondaryCollapsed}
                    aria-controls="secondary-navigation"
                  >
                    {secondaryCollapsed ? <PanelRightOpen size={16} aria-hidden="true" /> : <PanelRightClose size={16} aria-hidden="true" />}
                  </button>
                </div>
                <nav id="secondary-navigation" className="min-h-0 overflow-y-auto" aria-label={`${activeNavigationItem.label}业务导航`}>
                  <div className="flex flex-col gap-1">
                    {secondaryNavigationItems.map((child) => {
                      const active = child.match(pathname);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          aria-current={navigationAriaCurrent(pathname, child)}
                          title={secondaryCollapsed ? child.label : undefined}
                          className={`flex min-w-0 items-center rounded-md border-l-2 py-2.5 text-sm transition-colors ${secondaryCollapsed ? "justify-center px-2" : "gap-2.5 px-3"} ${active ? "border-teal-300/80 bg-teal-300/[0.07] text-teal-200" : "border-transparent text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"}`}
                        >
                          <SecondaryNavigationIcon href={child.href} />
                          <span className={secondaryCollapsed ? "sr-only" : "truncate"}>{child.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </nav>
              </aside>
            ) : null}

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <main id="main-content" className="af-shell-main min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 xl:px-8 xl:py-6" data-ai-page-context="true">{props.children}</main>
            </div>
          </div>

          <SharedStudyToolbar pathname={pathname} currentHref={currentHref} activeSession={currentActivitySession} syncState={syncState} />

          <nav
            className="af-shell-nav z-20 shrink-0 overflow-x-auto border-t border-white/10 bg-[#0d1117]/95 px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden"
            aria-label="移动导航"
          >
            <div className="mx-auto grid w-full max-w-lg grid-cols-6 items-center">
              {[...PRIMARY_WORKBENCH_ITEMS, UTILITY_NAV_ITEM].map((item) => {
                const active = item.match(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={navigationAriaCurrent(pathname, item)}
                    title={item.label}
                    className={`flex min-h-11 min-w-0 flex-col items-center gap-1 rounded-md px-1 py-2 text-center text-xs ${active ? "text-teal-300" : "text-zinc-400"}`}
                  >
                    <NavigationIcon href={item.href} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      </div>

      <RecoveryActionDrawer
        open={recoveryOpen}
        title={motivationDrawerSource === "automatic" ? "行动提醒" : "我学不下去了"}
        motivationLine={motivationLine}
        motivationUrl={motivationUrl}
        motivationError={recoveryError}
        workspaceId={status.workspaceId}
        defaultSubjectId={status.defaultSubjectId}
        onClose={() => setRecoveryOpen(false)}
      />
      <Drawer open={quickCreateOpen} title="快捷创建" onClose={() => setQuickCreateOpen(false)}>
        <nav className="grid gap-2" aria-label="创建对象">
          <QuickCreateLink href="/knowledge/points?create=1" label="知识点" onSelect={() => setQuickCreateOpen(false)} icon={<Goal size={18} aria-hidden="true" />} />
          <QuickCreateLink href="/knowledge/cards?create=1" label="笔记与卡片" onSelect={() => setQuickCreateOpen(false)} icon={<NotebookPen size={18} aria-hidden="true" />} />
          <QuickCreateLink href="/knowledge/mistakes?create=1" label="错题" onSelect={() => setQuickCreateOpen(false)} icon={<TriangleAlert size={18} aria-hidden="true" />} />
          <QuickCreateLink href="/knowledge/resources?create=1" label="资料" onSelect={() => setQuickCreateOpen(false)} icon={<FilePlus2 size={18} aria-hidden="true" />} />
        </nav>
      </Drawer>
      <Drawer open={lightOpen} title="今日状态" onClose={() => setLightOpen(false)}>
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
      </Drawer>
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
        action: { label: session.status === "closing" ? "完成收口" : `继续${activityLabel(session)}`, href: activityPath(session) },
      }
    : light);
  return { lights, mobileTop: selectMobileTopLight(lights) };
}

function isRenderableFocusSession(
  session: AppShellStatusDto["activeSession"],
): session is NonNullable<AppShellStatusDto["activeSession"]> {
  return Boolean(session && ["running", "paused", "closing"].includes(session.status));
}

function activityLabel(session: NonNullable<AppShellStatusDto["activeSession"]>): string {
  if (session.activityMode === "SIMULATION") return "模拟考试";
  if (session.activityMode === "RETEST") return "专项复测";
  if (session.activityMode === "KNOWLEDGE_REVIEW") return "复习";
  return "学习";
}

function activityPath(session: NonNullable<AppShellStatusDto["activeSession"]>): string {
  if (session.activityMode === "SIMULATION" && session.simulationExamId) return `/test/simulations/${encodeURIComponent(session.simulationExamId)}`;
  if (session.activityMode === "RETEST" && session.knowledgeRetestId) return `/test/retests/${encodeURIComponent(session.knowledgeRetestId)}`;
  if (session.activityMode === "KNOWLEDGE_REVIEW" && session.reviewScheduleId) return `/knowledge/reviews/${encodeURIComponent(session.reviewScheduleId)}`;
  return "/focus";
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

function shellSyncStateLabel(value: ShellSyncState): string {
  if (value === "offline") return "当前离线";
  if (value === "pending") return "本地操作待同步";
  if (value === "blocked") return "同步需要人工对账";
  if (value === "deferred") return "同步已暂缓";
  return "状态刷新失败";
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

function formatServerTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function navigationAriaCurrent(
  pathname: string,
  item: { href: string; match: (path: string) => boolean },
): "page" | "location" | undefined {
  if (!item.match(pathname)) return undefined;
  return pathname === item.href ? "page" : "location";
}

function NavigationIcon({ href }: { href: string }) {
  const Icon = PRIMARY_NAVIGATION_ICONS[href] ?? Settings;
  return <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />;
}

function SecondaryNavigationIcon({ href }: { href: string }) {
  const Icon = SECONDARY_NAVIGATION_ICONS[href] ?? Settings;
  return <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />;
}

const PRIMARY_NAVIGATION_ICONS: Record<string, LucideIcon> = {
  "/focus": Timer,
  "/today": CalendarCheck2,
  "/knowledge": BookOpen,
  "/test/retests": FileCheck2,
  "/roadmap": Route,
  "/settings/exams": Settings,
};

const SECONDARY_NAVIGATION_ICONS: Record<string, LucideIcon> = {
  "/roadmap": Goal,
  "/roadmap/allocation": Inbox,
  "/roadmap/stages": Milestone,
  "/roadmap/reviews": ChartSpline,
  "/knowledge": LayoutDashboard,
  "/knowledge/points": ListTodo,
  "/knowledge/syllabi": ListTree,
  "/knowledge/resources": FilePlus2,
  "/knowledge/cards": NotebookPen,
  "/knowledge/mistakes": TriangleAlert,
  "/knowledge/reviews": ClipboardCheck,
  "/test/retests": Repeat2,
  "/test/simulations": ScrollText,
  "/settings/exams": BriefcaseBusiness,
  "/settings/profile": UserRound,
  "/settings/learning": SlidersHorizontal,
  "/settings/ai": Sparkles,
  "/settings/data": ListTree,
  "/settings/system": MonitorCog,
};

function QuickCreateLink(props: {
  href: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <Link
      href={props.href}
      className="flex h-11 items-center gap-3 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/5"
      onClick={props.onSelect}
    >
      {props.icon}
      {props.label}
    </Link>
  );
}
