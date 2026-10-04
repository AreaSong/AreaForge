import { redirect } from "next/navigation";
import { UserNotificationInboxClient } from "@/components/user-notification-inbox-client";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/settings/notifications");

export default async function NotificationSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?returnTo=/settings/notifications");

  return (
    <PageFrame variant="dashboard-wide" className="space-y-6">
      <PageHeader
        eyebrow="设置 / 通知中心"
        title="通知中心"
        description="集中处理与你有关的成员与私有挑战事件；已读、隐藏和恢复状态会跨设备同步。"
      />
      <section aria-labelledby="notification-inbox-title" className="mx-auto w-full max-w-5xl space-y-3">
        <h2 id="notification-inbox-title" className="sr-only">成员与私有挑战通知</h2>
        <UserNotificationInboxClient enabled={process.env.PLATFORM_NOTIFICATIONS_ENABLED === "true"} />
      </section>
    </PageFrame>
  );
}
