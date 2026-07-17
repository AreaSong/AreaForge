"use client";

import { AlertTriangle, House, LifeBuoy, RotateCcw } from "lucide-react";
import Link from "next/link";

const SUPPORT_URL = "https://github.com/AreaSong/AreaForge/issues/new/choose";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#080b0f] px-4 py-8 text-zinc-100">
      <section className="w-full max-w-xl rounded-lg border border-white/10 bg-[#101419] p-6 shadow-2xl shadow-black/20 sm:p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-rose-300/25 bg-rose-300/10 text-rose-200">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-rose-200">页面暂时无法完成</p>
            <h1 className="mt-2 text-2xl font-semibold text-white">刚才这一步没有成功</h1>
            <p className="mt-3 text-sm leading-6 text-zinc-400">
              可以先重试；如果仍然无法恢复，请返回首页继续工作，或从支持入口反馈问题。
            </p>
          </div>
        </div>

        {error.digest ? (
          <p className="mt-6 border-t border-white/10 pt-4 font-mono text-xs text-zinc-500">
            参考编号：{error.digest}
          </p>
        ) : null}

        <p className="mt-4 text-xs leading-5 text-amber-100/80">
          GitHub 支持入口公开可见，请勿提交账号、学习正文、附件内容、服务器路径、日志或密钥。
        </p>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-400 px-4 text-sm font-medium text-[#071011] transition hover:bg-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-300/70 focus:ring-offset-2 focus:ring-offset-[#101419]"
            type="button"
            onClick={reset}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            重试
          </button>
          <Link
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/10 px-4 text-sm text-zinc-100 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-teal-300/70 focus:ring-offset-2 focus:ring-offset-[#101419]"
            href="/"
          >
            <House className="h-4 w-4" aria-hidden="true" />
            返回首页
          </Link>
          <a
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/10 px-4 text-sm text-zinc-300 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-teal-300/70 focus:ring-offset-2 focus:ring-offset-[#101419]"
            href={SUPPORT_URL}
            rel="noreferrer"
            target="_blank"
          >
            <LifeBuoy className="h-4 w-4" aria-hidden="true" />
            支持入口
          </a>
        </div>
      </section>
    </main>
  );
}
