import { redirect } from "next/navigation";
import { SettingsWorkbench } from "@/components/settings-workbench";
import { PageFrame, PageHeader } from "@/components/ui/page";
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
    <PageFrame variant="dashboard-wide">
      <PageHeader
        eyebrow="设置 / 系统"
        title="系统设置"
        description="查看版本与健康只读状态。Web 不执行 migration、deploy 或 updater apply。"
      />
      <SettingsWorkbench userEmail={user.email} initialStatus={updateStatus} />
    </PageFrame>
  );
}
