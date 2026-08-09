import { redirect } from "next/navigation";
import { ExperienceSettingsClient } from "@/components/experience-settings-client";
import { NotificationSettingsClient } from "@/components/notification-settings-client";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { getNotificationPreferences } from "@/lib/study/notification-preferences-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/settings/learning");

export default async function SettingsLearningPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const notificationPreferences = await getNotificationPreferences(user.id);

  return (
    <PageFrame variant="dashboard-wide" className="space-y-10">
      <PageHeader eyebrow="设置 / 学习与提醒" title="学习与提醒" description="把当前设备的提醒与界面偏好放在一个地方管理，不影响学习记录。" />
      <section className="space-y-4"><SectionHeader title="提醒" description="浏览器通知只在页面打开时发送；权限拒绝只降级，不循环请求。" /><NotificationSettingsClient userId={user.id} initial={notificationPreferences} /></section>
      <section className="space-y-4 border-t border-white/10 pt-8"><SectionHeader title="界面" description="这些设置只影响当前设备的显示与交互。" /><ExperienceSettingsClient /></section>
    </PageFrame>
  );
}
