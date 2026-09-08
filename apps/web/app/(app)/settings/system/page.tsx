import { redirect } from "next/navigation";
import { SettingsWorkbench } from "@/components/settings-workbench";
import { ControlledOperationsClient } from "@/components/controlled-operations-client";
import { OperatorAccountManagementClient } from "@/components/operator-account-management-client";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { getAuthEnv } from "@/lib/auth/env";
import { isPlatformOperatorEmail } from "@/lib/system/operator-policy";
import { listOperatorAccounts } from "@/lib/system/account-management-service";
import { getUpdateCenterStatus } from "@/lib/system/update-center";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/settings/system");

export default async function SettingsSystemPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const env = getAuthEnv();
  const isOperator = isPlatformOperatorEmail(user.email, env.AUTH_ADMIN_EMAIL);
  const updateStatus = await getUpdateCenterStatus();
  const accounts = isOperator && env.AUTH_RBAC_ENABLED ? await listOperatorAccounts(user) : [];

  return (
    <PageFrame variant="dashboard-wide" className="space-y-6">
      <PageHeader
        eyebrow="设置 / 系统"
        title="系统设置"
        description="查看版本与健康只读状态。Web 不执行 migration、deploy 或 updater apply。"
      />
      <SettingsWorkbench userEmail={user.email} initialStatus={updateStatus} />
      {isOperator && env.AUTH_RBAC_ENABLED ? <OperatorAccountManagementClient currentUserId={user.id} initialAccounts={accounts} /> : null}
      {isOperator ? <ControlledOperationsClient enabled /> : null}
    </PageFrame>
  );
}
