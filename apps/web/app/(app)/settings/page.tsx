import Link from "next/link";
import { redirect } from "next/navigation";
import { SettingsWorkbench } from "@/components/settings-workbench";
import { getCurrentUser } from "@/lib/auth/session";
import { getUpdateCenterStatus } from "@/lib/system/update-center";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const updateStatus = await getUpdateCenterStatus();

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">基础设置</h1>
          <p className="mt-1 text-sm text-zinc-400">账户与版本中心。通知/AI 入口本批不开放。</p>
        </div>
        <Link href="/settings/workspace" className="text-sm text-teal-300 hover:underline">
          考试工作区
        </Link>
      </div>
      <SettingsWorkbench userEmail={user.email} initialStatus={updateStatus} />
    </section>
  );
}
