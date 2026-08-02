import { redirect } from "next/navigation";
import { NotificationSettingsClient } from "@/components/notification-settings-client";
import { ButtonLink } from "@/components/ui/button";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { getNotificationPreferences } from "@/lib/study/notification-preferences-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/settings/notifications");

export default async function SettingsNotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const preference = await getNotificationPreferences(user.id);

  return (
    <PageFrame variant="dashboard-wide">
      <PageHeader
        eyebrow="设置 / 通知"
        title="通知偏好"
        description="浏览器通知仅在页面打开时发送；权限拒绝只降级，不循环请求。具体标题属于当前设备本地偏好。"
        action={<ButtonLink href="/today" variant="secondary">返回今日行动</ButtonLink>}
      />
      <NotificationSettingsClient userId={user.id} initial={preference} />
    </PageFrame>
  );
}
