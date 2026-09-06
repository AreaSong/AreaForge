import { redirect } from "next/navigation";
import { SettingsWorkbench } from "@/components/settings-workbench";
import { ControlledOperationsClient } from "@/components/controlled-operations-client";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { getAuthEnv } from "@/lib/auth/env";
import { isPlatformOperatorEmail } from "@/lib/system/operator-policy";
import { getUpdateCenterStatus } from "@/lib/system/update-center";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/settings/system");

export default async function SettingsSystemPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const updateStatus = await getUpdateCenterStatus();

  return (
    <PageFrame variant="dashboard-wide" className="space-y-6">
      <PageHeader
        eyebrow="设置 / 系统"
        title="系统设置"
        description="查看版本与健康只读状态。Web 不执行 migration、deploy 或 updater apply。"
      />
      <SettingsWorkbench userEmail={user.email} initialStatus={updateStatus} />
      {isPlatformOperatorEmail(user.email, getAuthEnv().AUTH_ADMIN_EMAIL) ? <ControlledOperationsClient enabled /> : null}
    </PageFrame>
  );
}
