"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { BrandMark } from "@/components/brand-logo";
import { LogoutButton } from "@/components/logout-button";
import { Drawer } from "@/components/ui/overlays";
import { BATCH8_NAV_ITEMS } from "@/lib/navigation/batch7";
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
            {BATCH8_NAV_ITEMS.map((item) => {
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
                onClick={() => setRecoveryOpen(true)}
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
              {BATCH8_NAV_ITEMS.map((item) => {
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
        <p className="text-sm text-zinc-400">启动恢复三阶，只突出一个最小行动。不会打开动机内容库。</p>
        {recoveryError ? <p className="mt-3 text-sm text-red-300">{recoveryError}</p> : null}
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            disabled={pending}
            className="h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black hover:bg-teal-400 disabled:opacity-60"
            onClick={() => void startRecovery()}
          >
            开始恢复最小行动
          </button>
          <Link href="/today" className="h-11 rounded-md border border-white/10 px-4 text-center text-sm leading-[2.75rem] text-zinc-200" onClick={() => setRecoveryOpen(false)}>
            回到今日
          </Link>
        </div>
      </Drawer>
    </div>
  );
}
