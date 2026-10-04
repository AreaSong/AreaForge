import { redirect } from "next/navigation";
import { AccountSecurityClient } from "@/components/account-security-client";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { listDeviceSessions } from "@/lib/auth/account-service";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/settings/account");

export default async function AccountSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?returnTo=/settings/account");
  const sessions = await listDeviceSessions(user);
  return (
    <PageFrame variant="dashboard-wide" className="space-y-6">
      <PageHeader eyebrow="设置 / 账户安全" title="账户与设备" description="管理邮箱验证、密码、重新验证窗口和当前账户的设备会话。" />
      <AccountSecurityClient
        email={user.email}
        emailVerifiedAt={user.emailVerifiedAt?.toISOString() ?? null}
        initialSessions={sessions}
        status={user.status}
      />
    </PageFrame>
  );
}
