"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  BookOpen,
  CalendarCheck2,
  CalendarRange,
  CheckCheck,
  ClipboardCheck,
  FilePlus2,
  Flag,
  ListTree,
  ListTodo,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Settings,
  Timer,
  TriangleAlert,
} from "lucide-react";
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
import { subscribeFocusOfflineSync, syncFocusOfflineQueue } from "@/lib/client/focus-offline-store";
import { getClientDeviceHeaders } from "@/lib/client/device-identity";
import { GlobalAiAssistant } from "@/components/global-ai-assistant";
import { WorkbenchBreadcrumb } from "@/components/workbench-breadcrumb";
import { SharedStudyToolbar } from "@/components/shared-study-toolbar";
import { BATCH10_NAV_ITEMS, isContentDetailPath } from "@/lib/navigation/batch7";
import type { AppShellStatusDto } from "@/lib/study/app-shell-service";

const toneClass: Record<string, string> = {
  gray: "border-zinc-600 text-zinc-400",
  blue: "border-sky-400/50 text-sky-200",
  green: "border-emerald-400/50 text-emerald-200",
  amber: "border-amber-400/50 text-amber-200",
  red: "border-red-400/50 text-red-200",
};

type ShellSyncState = "current" | "offline" | "unavailable";

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
  const immersive = pathname.startsWith("/focus/") || pathname.startsWith("/quick-review/");
  const currentHref = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
  const activeNavigationItem = BATCH10_NAV_ITEMS.find((item) => item.match(pathname));
  const secondaryNavigationItems = activeNavigationItem?.children ?? [];
  const showSecondaryNavigation = secondaryNavigationItems.length > 0 && !isContentDetailPath(pathname);
  const displayStatus = projectLocalQuickReviewStatus(status, quickReviewClaim);
  const activeSessionId = status.activeSession?.id;
  const activeSessionStatus = status.activeSession?.status;
  const closeoutPath = activeSessionId ? `/focus/${activeSessionId}` : null;
  const outsideCloseout = activeSessionStatus === "closing" && closeoutPath !== null && pathname !== closeoutPath;

  useEffect(() => {
    if (!outsideCloseout || !closeoutPath) return;
    router.replace(closeoutPath);
  }, [closeoutPath, outsideCloseout, router]);

  useEffect(() => subscribeQuickReviewActivity(props.userId, setQuickReviewClaim), [props.userId]);

  useEffect(() => {
    const sync = () => {
      void syncFocusOfflineQueue(props.userId);
    };
    sync();
    window.addEventListener("online", sync);
    const interval = window.setInterval(sync, 15_000);
    return () => {
      window.removeEventListener("online", sync);
      window.clearInterval(interval);
    };
  }, [props.userId]);

  useEffect(() => {
    const unsubscribe = subscribeFocusOfflineSync((event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; session?: AppShellStatusDto["activeSession"] | null }>).detail;
      if (detail?.userId !== props.userId || detail.session === undefined) return;
      setStatus((current) => ({
        ...current,
        activeSession: detail.session && ["running", "paused", "closing"].includes(detail.session.status)
          ? detail.session
          : null,
      }));
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
          setStatus(body.status);
          setSyncState("current");
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
    if (immersive || document.visibilityState !== "visible" || !("Notification" in window)) return;
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
  }, [immersive, router, status]);

  useEffect(() => {
    if (immersive || !status.workspaceId) return;
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
        immersive,
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
  }, [immersive, props.userId, status.motivationReminderCandidate, status.workspaceId]);

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
        <SharedStudyToolbar pathname={pathname} currentHref={currentHref} activeSession={status.activeSession} syncState={syncState} />
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
        <SharedStudyToolbar pathname={pathname} currentHref={currentHref} activeSession={status.activeSession} syncState={syncState} />
      </main>
    );
  }

  return (
    <div className="af-app-shell h-dvh overflow-hidden bg-[var(--af-canvas)] text-zinc-100">
      <div className="flex h-full w-full">
        <aside
          aria-label="一级导航"
          className={`hidden shrink-0 flex-col border-r border-white/10 bg-[var(--af-surface-subtle)] px-3 py-5 transition-[width] lg:flex ${sidebarCollapsed ? "w-16" : "w-56"}`}
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
            >
              {sidebarCollapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
            </button>
          </div>
          <nav className="flex flex-col gap-1" aria-label="主导航">
            {BATCH10_NAV_ITEMS.map((item) => {
              const active = item.match(pathname);
              const activeChild = item.children?.some((child) => child.match(pathname)) ?? false;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active && !activeChild ? navigationAriaCurrent(pathname, item) : undefined}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={`flex min-w-0 items-center rounded-md py-2 text-sm ${sidebarCollapsed ? "justify-center px-2" : "gap-3 px-3"} ${active ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"}`}
                >
                  <NavigationIcon href={item.href} />
                  <span className={sidebarCollapsed ? "sr-only" : "truncate"}>{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className={`mt-auto space-y-2 pt-6 text-xs text-zinc-500 ${sidebarCollapsed ? "grid justify-items-center" : "px-2"}`}>
            <p className={sidebarCollapsed ? "sr-only" : undefined}>{props.email}</p>
            <LogoutButton compact={sidebarCollapsed} userId={props.userId} />
          </div>
        </aside>

        {showSecondaryNavigation && activeNavigationItem ? (
          <aside
            aria-label={`${activeNavigationItem.label}二级导航`}
            className={`hidden shrink-0 flex-col border-r border-white/10 bg-[#0b0f14] py-5 transition-[width] lg:flex ${secondaryCollapsed ? "w-16 px-2" : "w-56 px-3"}`}
          >
            <div className={`mb-5 flex items-center ${secondaryCollapsed ? "justify-center" : "justify-between gap-2 px-2"}`}>
              <p className={secondaryCollapsed ? "sr-only" : "truncate text-xs font-medium uppercase tracking-[0.12em] text-zinc-500"}>{activeNavigationItem.label}</p>
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white"
                onClick={toggleSecondary}
                aria-label={secondaryCollapsed ? "展开二级导航" : "收起二级导航"}
                title={secondaryCollapsed ? "展开二级导航" : "收起二级导航"}
              >
                {secondaryCollapsed ? <PanelRightOpen size={17} aria-hidden="true" /> : <PanelRightClose size={17} aria-hidden="true" />}
              </button>
            </div>
            <nav className="flex flex-col gap-1" aria-label={`${activeNavigationItem.label}业务导航`}>
              {secondaryNavigationItems.map((child) => {
                const active = child.match(pathname);
                return (
                  <Link
                    key={child.href}
                    href={child.href}
                    aria-current={navigationAriaCurrent(pathname, child)}
                    title={secondaryCollapsed ? child.label : undefined}
                    className={`flex min-w-0 items-center rounded-md py-2.5 text-sm ${secondaryCollapsed ? "justify-center px-2" : "gap-3 px-3"} ${active ? "bg-teal-400/10 text-teal-200" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"}`}
                  >
                    <SecondaryNavigationIcon href={child.href} />
                    <span className={secondaryCollapsed ? "sr-only" : "truncate"}>{child.label}</span>
                  </Link>
                );
              })}
            </nav>
          </aside>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:min-h-screen">
          <header className="af-shell-header z-20 shrink-0 border-b border-white/10 bg-[color:var(--af-canvas)]/95 px-4 py-3 backdrop-blur sm:px-6 xl:px-8">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex shrink-0 items-center gap-2 lg:hidden">
                  <BrandMark size={20} />
                  <span className="text-sm text-teal-300">AreaForge</span>
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
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-2 text-xs md:hidden ${toneClass[displayStatus.mobileTop.tone] ?? toneClass.gray}`}
                  onClick={openStatusLight}
                  aria-label={`状态：${displayStatus.mobileTop.summary}`}
                  aria-expanded={lightOpen}
                >
                  <Activity size={15} aria-hidden="true" />
                  状态
                </button>
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
            </div>
            <p
              className={`${syncState === "current" ? "sr-only md:mt-2 md:block md:text-xs md:text-zinc-500" : "mt-2 text-xs text-amber-200"}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {syncState === "current"
                ? `状态同步于 ${formatServerTime(status.serverTime)}`
                : `${syncState === "offline" ? "当前离线" : "状态刷新失败"}；显示上次服务端状态（${formatServerTime(status.serverTime)}）`}
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
                <GlobalAiAssistant userId={props.userId} placement="breadcrumb" />
              </WorkbenchBreadcrumb>
            ) : null}
          </header>

          <main className="af-shell-main min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 xl:px-8 xl:py-6" data-ai-page-context="true">{props.children}</main>

          <SharedStudyToolbar pathname={pathname} currentHref={currentHref} activeSession={status.activeSession} syncState={syncState} />

          <nav
            className="af-shell-nav z-20 shrink-0 overflow-x-auto border-t border-white/10 bg-[#0d1117]/95 px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden"
            aria-label="移动导航"
          >
            <div className="mx-auto flex min-w-max items-center sm:grid sm:max-w-lg sm:min-w-0 sm:grid-cols-9">
              {BATCH10_NAV_ITEMS.map((item) => {
                const active = item.match(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={navigationAriaCurrent(pathname, item)}
                    className={`min-w-16 truncate rounded-md px-2 py-2 text-center text-xs ${active ? "text-teal-300" : "text-zinc-400"}`}
                  >
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
          <QuickCreateLink href="/plan?createMinimum=1" label="任务" onSelect={() => setQuickCreateOpen(false)} icon={<CalendarCheck2 size={18} aria-hidden="true" />} />
          <QuickCreateLink href="/knowledge/notes?create=1" label="知识卡片" onSelect={() => setQuickCreateOpen(false)} icon={<NotebookPen size={18} aria-hidden="true" />} />
          <QuickCreateLink href="/knowledge/mistakes?create=1" label="错题" onSelect={() => setQuickCreateOpen(false)} icon={<TriangleAlert size={18} aria-hidden="true" />} />
          <QuickCreateLink href="/knowledge/resources?create=1" label="资料" onSelect={() => setQuickCreateOpen(false)} icon={<FilePlus2 size={18} aria-hidden="true" />} />
          <QuickCreateLink href="/knowledge/syllabus?create=1" label="考纲节点" onSelect={() => setQuickCreateOpen(false)} icon={<ListTree size={18} aria-hidden="true" />} />
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
  const Icon = href === "/focus"
    ? Timer
    : href === "/today"
    ? CalendarCheck2
    : href === "/plan"
      ? CalendarRange
    : href === "/plan/stages"
      ? Flag
    : href === "/knowledge/overview"
      ? BookOpen
    : href === "/test"
      ? CheckCheck
    : href === "/review/daily"
      ? ClipboardCheck
    : href === "/confirmations"
      ? CheckCheck
    : href === "/settings/workspace"
      ? Settings
      : Settings;
  return <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />;
}

function SecondaryNavigationIcon({ href }: { href: string }) {
  const Icon = href === "/plan/stages"
    ? Flag
    : href === "/plan/inbox"
      ? ListTodo
      : href === "/plan"
        ? CalendarRange
        : href === "/knowledge/overview"
          ? BookOpen
          : href === "/knowledge/points" || href === "/knowledge/syllabus"
            ? ListTree
            : href === "/knowledge/resources" || href === "/knowledge/imports"
              ? FilePlus2
              : href === "/knowledge/notes"
                ? NotebookPen
                : href === "/knowledge/mistakes"
                  ? TriangleAlert
                  : href === "/knowledge/reviews" || href === "/review/daily"
                    ? ClipboardCheck
                    : href === "/knowledge/canvas"
                      ? Activity
                      : href === "/test/retests"
                        ? ClipboardCheck
                        : href === "/test/simulations"
                          ? CheckCheck
                          : href === "/review/reports"
                            ? CalendarRange
                            : CheckCheck;
  return <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />;
}

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
