"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CalendarCheck2,
  ClipboardCheck,
  FilePlus2,
  Flag,
  Network,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
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
import { BATCH10_NAV_ITEMS } from "@/lib/navigation/batch7";
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
  const router = useRouter();
  const [status, setStatus] = useState(props.initialStatus);
  const [syncState, setSyncState] = useState<ShellSyncState>("current");
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [motivationDrawerSource, setMotivationDrawerSource] = useState<"manual" | "automatic">("manual");
  const [lightOpen, setLightOpen] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [motivationLine, setMotivationLine] = useState<string | null>(null);
  const [motivationUrl, setMotivationUrl] = useState<string | null>(null);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [quickReviewClaim, setQuickReviewClaim] = useState<QuickReviewActivityClaim | null>(null);
  const immersive = pathname.startsWith("/focus/") || pathname.startsWith("/quick-review/");
  const activeNavigationItem = BATCH10_NAV_ITEMS.find((item) => item.match(pathname));
  const displayStatus = projectLocalQuickReviewStatus(status, quickReviewClaim);

  useEffect(() => subscribeQuickReviewActivity(props.userId, setQuickReviewClaim), [props.userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSidebarCollapsed(window.localStorage.getItem("af.sidebar.collapsed") === "1");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("af.sidebar.collapsed", next ? "1" : "0");
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const response = await fetch("/api/app-shell/status");
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
      return window.localStorage.getItem(key) !== "1";
    });
    if (!category) return;
    const dedupeKey = `af.notification.sent.${status.workspaceId ?? "setup"}.${date}.${category}`;
    const payload = buildForegroundNotificationPayload(category);
    const showSpecificTitle = window.localStorage.getItem("af.notification.showSpecificTitle") === "1";
    const notification = new Notification(showSpecificTitle ? payload.title : "AreaForge 提醒", {
      body: payload.body,
      tag: payload.tag,
      data: payload.data,
    });
    window.localStorage.setItem(dedupeKey, "1");
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
      const nextEligibleAt = Number(window.localStorage.getItem(cooldownKey) ?? "0");
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
        window.localStorage.setItem(cooldownKey, String(Date.now() + cooldown));
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
    return <main className="min-h-screen bg-[#080b0f] text-zinc-100">{props.children}</main>;
  }

  return (
    <div className="af-app-shell h-dvh overflow-hidden bg-[#080b0f] text-zinc-100 lg:h-auto lg:min-h-screen lg:overflow-visible">
      <div className="mx-auto flex h-full w-full max-w-7xl lg:min-h-screen">
        <aside className={`hidden shrink-0 flex-col border-r border-white/10 px-3 py-5 transition-[width] lg:flex ${sidebarCollapsed ? "w-16" : "w-56"}`}>
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
                <div key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active && !activeChild ? navigationAriaCurrent(pathname, item) : undefined}
                    title={sidebarCollapsed ? item.label : undefined}
                    className={`flex items-center rounded-md py-2 text-sm ${sidebarCollapsed ? "justify-center px-2" : "gap-3 px-3"} ${active ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"}`}
                  >
                    <NavigationIcon href={item.href} />
                    <span className={sidebarCollapsed ? "sr-only" : undefined}>{item.label}</span>
                  </Link>
                  {!sidebarCollapsed ? item.children?.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      aria-current={navigationAriaCurrent(pathname, child)}
                      className={`mt-1 block rounded-md py-1.5 pl-7 pr-3 text-xs ${child.match(pathname) ? "text-teal-300" : "text-zinc-500 hover:text-zinc-200"}`}
                    >
                      {child.label}
                    </Link>
                  )) : null}
                </div>
              );
            })}
          </nav>
          <div className={`mt-auto space-y-2 pt-6 text-xs text-zinc-500 ${sidebarCollapsed ? "grid justify-items-center" : "px-2"}`}>
            <p className={sidebarCollapsed ? "sr-only" : undefined}>{props.email}</p>
            <LogoutButton compact={sidebarCollapsed} />
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:min-h-screen">
          <header className="af-shell-header sticky top-0 z-20 shrink-0 border-b border-white/10 bg-[#080b0f]/95 px-4 py-3 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 lg:hidden">
                <BrandMark size={20} />
                <span className="text-sm text-teal-300">AreaForge</span>
              </div>
              <div className="hidden items-center gap-2 md:flex" aria-label="状态灯">
                {displayStatus.lights.map((light) => (
                  <button
                    key={light.kind}
                    type="button"
                    className={`rounded-md border px-2 py-1 text-xs ${toneClass[light.tone] ?? toneClass.gray}`}
                    onClick={() => setLightOpen(light.kind)}
                    aria-label={`${light.label}：${light.summary}`}
                  >
                    {light.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={`rounded-md border px-2 py-1 text-xs md:hidden ${toneClass[displayStatus.mobileTop.tone] ?? toneClass.gray}`}
                onClick={() => setLightOpen(displayStatus.mobileTop.kind)}
                aria-label={`状态：${displayStatus.mobileTop.summary}`}
              >
                {displayStatus.mobileTop.label}
              </button>
              <div className="flex items-center gap-2">
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
                  className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5"
                  onClick={() => void openMotivationHelp()}
                >
                  我学不下去了
                </button>
              </div>
            </div>
            <p
              className={`mt-2 text-xs ${syncState === "current" ? "text-zinc-500" : "text-amber-200"}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {syncState === "current"
                ? `状态同步于 ${formatServerTime(status.serverTime)}`
                : `${syncState === "offline" ? "当前离线" : "状态刷新失败"}；显示上次服务端状态（${formatServerTime(status.serverTime)}）`}
            </p>
            {lightOpen ? (
              <div className="mt-3 rounded-md border border-white/10 bg-[#101419] p-3 text-sm">
                {displayStatus.lights
                  .filter((light) => light.kind === lightOpen)
                  .map((light) => (
                    <div key={light.kind} className="space-y-2">
                      <p className="font-medium text-white">{light.label}</p>
                      <p className="text-zinc-400">{light.summary}</p>
                      {light.action ? (
                        <Link href={light.action.href} className="inline-flex text-teal-300 hover:underline" onClick={() => setLightOpen(null)}>
                          {light.action.label}
                        </Link>
                      ) : null}
                      <button type="button" className="block text-xs text-zinc-500" onClick={() => setLightOpen(null)}>
                        收起
                      </button>
                    </div>
                  ))}
              </div>
            ) : null}
            {activeNavigationItem?.children?.length ? (
              <nav className="mt-3 flex gap-2 lg:hidden" aria-label={`${activeNavigationItem.label}子导航`}>
                {activeNavigationItem.children.map((child) => (
                  <Link
                    key={child.href}
                    href={child.href}
                    aria-current={navigationAriaCurrent(pathname, child)}
                    className={`rounded-md border px-3 py-1.5 text-xs ${child.match(pathname) ? "border-teal-400/50 text-teal-200" : "border-white/10 text-zinc-400"}`}
                  >
                    {child.label}
                  </Link>
                ))}
              </nav>
            ) : null}
          </header>

          <main className="af-shell-main min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:overflow-visible lg:pb-6">{props.children}</main>

          <nav
            className="af-shell-nav z-20 shrink-0 border-t border-white/10 bg-[#0d1117]/95 px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden"
            aria-label="移动导航"
          >
            <div className="mx-auto grid max-w-lg grid-cols-5 items-center">
              {BATCH10_NAV_ITEMS.map((item) => {
                const active = item.match(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={navigationAriaCurrent(pathname, item)}
                    className={`min-w-0 truncate rounded-md px-1 py-2 text-center text-xs ${active ? "text-teal-300" : "text-zinc-400"}`}
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
          <QuickCreateLink href="/today/plan?createMinimum=1" label="任务" onSelect={() => setQuickCreateOpen(false)} icon={<CalendarCheck2 size={18} aria-hidden="true" />} />
          <QuickCreateLink href="/knowledge/notes?create=1" label="知识卡片" onSelect={() => setQuickCreateOpen(false)} icon={<NotebookPen size={18} aria-hidden="true" />} />
          <QuickCreateLink href="/knowledge/mistakes?create=1" label="错题" onSelect={() => setQuickCreateOpen(false)} icon={<TriangleAlert size={18} aria-hidden="true" />} />
          <QuickCreateLink href="/knowledge/resources?create=1" label="资料" onSelect={() => setQuickCreateOpen(false)} icon={<FilePlus2 size={18} aria-hidden="true" />} />
        </nav>
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
  const Icon = href === "/today"
    ? CalendarCheck2
    : href === "/knowledge/canvas"
      ? Network
      : href === "/review/reports"
        ? ClipboardCheck
        : href === "/stage/overview"
          ? Flag
          : Settings;
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
