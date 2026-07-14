import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandBreadcrumb } from "@/components/brand-logo";
import { SettingsWorkbench } from "@/components/settings-workbench";
import { getCurrentUser } from "@/lib/auth/session";
import { getUpdateCenterStatus } from "@/lib/system/update-center";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const updateStatus = await getUpdateCenterStatus();

  return (
    <main className="min-h-screen bg-[#080b0f] text-zinc-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <BrandBreadcrumb section="Settings" />
            <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
              设置
            </h1>
            <p className="mt-2 text-sm text-zinc-500">账号、运行状态、版本更新和自动策略。</p>
          </div>
          <Link
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10"
            href="/"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            返回作战台
          </Link>
        </header>

        <SettingsWorkbench
          userEmail={user.email}
          initialStatus={updateStatus}
        />
      </div>
    </main>
  );
}
