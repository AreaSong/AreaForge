import { ArrowLeft, Archive } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MotivationVaultForm } from "@/components/motivation-vault-form";
import { getCurrentUser } from "@/lib/auth/session";
import { getMotivationVault } from "@/lib/study/service";

export const dynamic = "force-dynamic";

export default async function MotivationPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const vault = await getMotivationVault();

  return (
    <main className="min-h-screen bg-[#080b0f] text-zinc-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3 text-sm text-teal-300">
              <Archive className="h-4 w-4" aria-hidden="true" />
              <span>AreaForge / Motivation</span>
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
              动机封存
            </h1>
            <p className="mt-2 text-sm text-zinc-500">把开始的原因收好，只在关键节点短暂唤醒。</p>
          </div>
          <Link
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10"
            href="/"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            返回作战台
          </Link>
        </header>

        <MotivationVaultForm vault={vault} />
      </div>
    </main>
  );
}
