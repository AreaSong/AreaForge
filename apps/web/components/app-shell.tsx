"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { selectForegroundNotifications, type ForegroundNotificationCategory } from "@areaforge/core";
import { BrandMark } from "@/components/brand-logo";
import { LogoutButton } from "@/components/logout-button";
import { Drawer } from "@/components/ui/overlays";
import { BATCH10_NAV_ITEMS } from "@/lib/navigation/batch7";
import type { AppShellStatusDto } from "@/lib/study/app-shell-service";

const toneClass: Record<string, string> = {
  gray: "border-zinc-600 text-zinc-400",
  blue: "border-sky-400/50 text-sky-200",
  green: "border-emerald-400/50 text-emerald-200",
  amber: "border-amber-400/50 text-amber-200",
  red: "border-red-400/50 text-red-200",
};

export function AppShell(props: {
  children: React.ReactNode;
  initialStatus: AppShellStatusDto;
  email: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState(props.initialStatus);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [lightOpen, setLightOpen] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [motivationLine, setMotivationLine] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const immersive = pathname.startsWith("/focus/") || pathname.startsWith("/quick-review/");

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const response = await fetch("/api/app-shell/status");
        if (!response.ok) return;
        const body = (await response.json()) as { status: AppShellStatusDto };
        if (!cancelled) setStatus(body.status);
      } catch {
        // keep last trusted status
      }
    }
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    if (immersive || document.visibilityState !== "visible" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    const shanghaiNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const category = selectForegroundNotifications({
      hour: shanghaiNow.getUTCHours(),
      preference: status.notificationPreference,
      candidates: status.notificationCandidates,
    })[0];
    if (!category) return;

    const date = shanghaiNow.toISOString().slice(0, 10);
    const dedupeKey = `af.notification.sent.${status.workspaceId ?? "setup"}.${date}.${category}`;
    if (window.localStorage.getItem(dedupeKey) === "1") return;
    const payload = foregroundNotificationPayload(category);
    const showSpecificTitle = window.localStorage.getItem("af.notification.showSpecificTitle") === "1";
    const notification = new Notification(showSpecificTitle ? payload.title : "AreaForge 提醒", {
      body: payload.body,
      tag: payload.tag,
      data: { route: payload.route },
    });
    window.localStorage.setItem(dedupeKey, "1");
    notification.onclick = () => {
      window.focus();
      router.push(sanitizeNotificationRoute(payload.route));
      notification.close();
    };
  }, [immersive, router, status]);

  async function openMotivationHelp() {
    setRecoveryError(null);
    setMotivationLine(null);
    setRecoveryOpen(true);
    try {
      const response = await fetch("/api/motivation/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordReminder: false }),
      });
      const body = (await response.json().catch(() => null)) as
        | { item?: { title?: string; body?: string | null; externalUrl?: string | null }; error?: string }
        | null;
      if (!response.ok) {
        setRecoveryError(body?.error ?? "无法加载动机内容");
        return;
      }
      if (body?.item) {
        const line = body.item.body ?? body.item.externalUrl ?? body.item.title ?? null;
        setMotivationLine(line);
      } else {
        setMotivationLine("内容库为空。可到设置 → 档案添加语录。");
      }
    } catch {
      setRecoveryError("无法加载动机内容");
    }
  }

  async function startRecovery() {
    setRecoveryError(null);
    const response = await fetch("/api/recovery/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "我学不下去了" }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setRecoveryError(body?.error ?? "无法启动恢复");
      return;
    }
    setRecoveryOpen(false);
    startTransition(() => router.refresh());
  }

  async function startFiveMinutes() {
    setRecoveryError(null);
    if (!status.defaultSubjectId) {
      setRecoveryError("当前工作区没有可用科目，请先完成工作区设置。");
      return;
    }
    const response = await fetch("/api/study-sessions/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjectId: status.defaultSubjectId, goalMinutes: 5, startSource: "RECOVERY" }),
    });
    const body = await response.json().catch(() => null) as { session?: { id: string }; latest?: { id?: string }; error?: string } | null;
    const sessionId = body?.session?.id ?? (response.status === 409 ? body?.latest?.id : undefined);
    if (!response.ok && !sessionId) {
      setRecoveryError(body?.error ?? "无法启动 5 分钟行动");
      return;
    }
    if (!sessionId) {
      setRecoveryError("未返回可继续的计时活动");
      return;
    }
    setRecoveryOpen(false);
    router.push(`/focus/${sessionId}?returnTo=${encodeURIComponent(pathname)}`);
  }

  if (immersive) {
    return <div className="min-h-screen bg-[#080b0f] text-zinc-100">{props.children}</div>;
  }

  return (
    <div className="min-h-screen bg-[#080b0f] text-zinc-100">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-white/10 px-3 py-5 lg:flex">
          <div className="mb-6 flex items-center gap-2 px-2 text-teal-300">
            <BrandMark size={22} />
            <span className="text-sm font-medium">AreaForge</span>
          </div>
          <nav className="flex flex-col gap-1" aria-label="主导航">
            {BATCH10_NAV_ITEMS.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-3 py-2 text-sm ${active ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto space-y-2 px-2 pt-6 text-xs text-zinc-500">
            <p>{props.email}</p>
            <LogoutButton />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-white/10 bg-[#080b0f]/95 px-4 py-3 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 lg:hidden">
                <BrandMark size={20} />
                <span className="text-sm text-teal-300">AreaForge</span>
              </div>
              <div className="hidden items-center gap-2 md:flex" aria-label="状态灯">
                {status.lights.map((light) => (
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
                className={`rounded-md border px-2 py-1 text-xs md:hidden ${toneClass[status.mobileTop.tone] ?? toneClass.gray}`}
                onClick={() => setLightOpen(status.mobileTop.kind)}
                aria-label={`状态：${status.mobileTop.summary}`}
              >
                {status.mobileTop.label}
              </button>
              <button
                type="button"
                className="rounded-md border border-white/10 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5"
                onClick={() => void openMotivationHelp()}
              >
                我学不下去了
              </button>
            </div>
            {lightOpen ? (
              <div className="mt-3 rounded-md border border-white/10 bg-[#101419] p-3 text-sm">
                {status.lights
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
          </header>

          <main className="flex-1 px-4 py-5 pb-24 sm:px-6 lg:pb-6">{props.children}</main>

          <nav
            className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[#0d1117]/95 px-2 py-2 backdrop-blur lg:hidden"
            aria-label="移动导航"
          >
            <div className="mx-auto flex max-w-lg items-center justify-around">
              {BATCH10_NAV_ITEMS.slice(0, 5).map((item) => {
                const active = item.match(pathname);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-md px-3 py-2 text-xs ${active ? "text-teal-300" : "text-zinc-400"}`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      </div>

      <Drawer open={recoveryOpen} title="我学不下去了" onClose={() => setRecoveryOpen(false)}>
        <p className="text-sm text-zinc-400">一条匹配内容 + 三个恢复动作。内容消费不是完成指标。</p>
        {motivationLine ? <p className="mt-3 rounded-md border border-white/10 p-3 text-sm text-zinc-200">{motivationLine}</p> : null}
        {recoveryError ? <p className="mt-3 text-sm text-red-300">{recoveryError}</p> : null}
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            className="h-11 rounded-md border border-white/10 px-4 text-sm text-zinc-200 hover:bg-white/5"
            onClick={() => setRecoveryOpen(false)}
          >
            继续当前
          </button>
          <button
            type="button"
            disabled={pending}
            className="h-11 rounded-md border border-white/10 px-4 text-center text-sm leading-[2.75rem] text-zinc-200"
            onClick={() => void startFiveMinutes()}
          >
            启动 5 分钟
          </button>
          <button
            type="button"
            disabled={pending}
            className="h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black hover:bg-teal-400 disabled:opacity-60"
            onClick={() => void startRecovery()}
          >
            切换到最小任务
          </button>
          <Link href="/settings/profile" className="text-center text-xs text-teal-300 hover:underline" onClick={() => setRecoveryOpen(false)}>
            管理动机内容库
          </Link>
        </div>
      </Drawer>
    </div>
  );
}

function foregroundNotificationPayload(category: ForegroundNotificationCategory) {
  switch (category) {
    case "review":
      return { title: "复习提醒", body: "有到期复习可处理。", tag: "af-review-due", route: "/knowledge/reviews" };
    case "plan":
      return { title: "计划提醒", body: "今日计划窗口已到。", tag: "af-plan-start", route: "/today/plan" };
    case "evening":
      return { title: "复盘提醒", body: "晚间复盘窗口已到。", tag: "af-evening-review", route: "/review/daily" };
  }
}

function sanitizeNotificationRoute(route: string): string {
  return ["/knowledge/reviews", "/today/plan", "/review/daily"].includes(route) ? route : "/today";
}
