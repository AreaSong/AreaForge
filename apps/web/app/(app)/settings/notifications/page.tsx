import { redirect } from "next/navigation";
import { NotificationSettingsClient } from "@/components/notification-settings-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getNotificationPreferences } from "@/lib/study/notification-preferences-service";

export const dynamic = "force-dynamic";

export default async function SettingsNotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const preference = await getNotificationPreferences(user.id);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-white">通知偏好</h2>
        <p className="mt-1 text-sm text-zinc-400">
          浏览器通知仅在页面打开时发送；权限拒绝只降级，不循环请求。具体标题属于当前设备本地偏好。
        </p>
      </div>
      <NotificationSettingsClient initial={preference} />
    </section>
  );
}
