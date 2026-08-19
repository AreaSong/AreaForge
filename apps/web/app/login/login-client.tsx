import Image from "next/image";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { AmbientBackground } from "./components/ambient-background";
import { ShowcaseStage } from "./components/showcase-stage";

export function LoginClient({ returnTo }: { returnTo: string }) {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#07100f] text-zinc-100 selection:bg-teal-400/25">
      <AmbientBackground />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[1440px] flex-col px-4 py-5 sm:px-6 lg:px-10 lg:py-6">
        <header className="flex items-center justify-between gap-4">
          <Image
            alt="AreaForge"
            className="h-8 w-auto object-contain sm:h-9"
            height={98}
            priority
            src="/brand/areaforge-logo-lockup.svg"
            width={300}
          />
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-xs text-zinc-300 backdrop-blur-sm">
            <span aria-hidden className="size-1.5 rounded-full bg-teal-300" />
            学习行动中心
          </span>
        </header>

        <div className="grid flex-1 items-center gap-7 py-7 lg:grid-cols-[minmax(0,1fr)_390px] lg:gap-10 lg:py-4 xl:gap-14">
          <div className="order-2 min-w-0 lg:order-1">
            <ShowcaseStage />
          </div>

          <aside
            aria-label="登录 AreaForge"
            className="order-1 mx-auto flex w-full max-w-[390px] items-center lg:order-2"
          >
            <div className="relative w-full">
              <div
                aria-hidden
                className="pointer-events-none absolute -inset-6 rounded-[2.5rem] bg-teal-300/[0.08] blur-3xl"
              />
              <LoginForm returnTo={returnTo} />
            </div>
          </aside>
        </div>

        <footer className="flex flex-col gap-2 border-t border-white/[0.07] pt-4 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <span>面向个人长期备考的自我锻造与考研督战系统</span>
          <span className="flex flex-wrap items-center gap-3 text-zinc-400">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck aria-hidden className="size-3.5 text-teal-300" />
              私有学习工作区
            </span>
            <span className="inline-flex items-center gap-1.5">
              <LockKeyhole aria-hidden className="size-3.5 text-teal-300" />
              邮箱与密码登录
            </span>
          </span>
        </footer>
      </div>
    </main>
  );
}
