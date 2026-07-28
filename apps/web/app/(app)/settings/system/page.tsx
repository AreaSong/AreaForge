import { redirect } from "next/navigation";
import { SettingsWorkbench } from "@/components/settings-workbench";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { getUpdateCenterStatus } from "@/lib/system/update-center";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/settings/system");

export default async function SettingsSystemPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const updateStatus = await getUpdateCenterStatus();

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-white">系统设置</h1>
        <p className="mt-1 text-sm text-zinc-400">版本与健康只读状态。Web 不执行 migration、deploy 或 updater apply。</p>
      </div>
      <SettingsWorkbench userEmail={user.email} initialStatus={updateStatus} />
    </section>
  );
}
