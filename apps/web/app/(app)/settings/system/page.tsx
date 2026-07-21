import { redirect } from "next/navigation";
import { SettingsWorkbench } from "@/components/settings-workbench";
import { getCurrentUser } from "@/lib/auth/session";
import { getUpdateCenterStatus } from "@/lib/system/update-center";

export const dynamic = "force-dynamic";

export default async function SettingsSystemPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const updateStatus = await getUpdateCenterStatus();

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-white">系统</h2>
        <p className="mt-1 text-sm text-zinc-400">版本与健康只读状态。Web 不执行 migration、deploy 或 updater apply。</p>
      </div>
      <SettingsWorkbench userEmail={user.email} initialStatus={updateStatus} />
    </section>
  );
}
