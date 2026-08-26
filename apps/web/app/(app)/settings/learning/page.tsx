import { redirect } from "next/navigation";
import { Bell, Laptop, Moon, Sparkles } from "lucide-react";
import { ExperienceSettingsClient } from "@/components/experience-settings-client";
import { NotificationSettingsClient } from "@/components/notification-settings-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { PageFrame, PageHeader } from "@/components/ui/page";
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
    <PageFrame variant="dashboard-wide" className="space-y-6">
      <PageHeader
        eyebrow="设置 / 学习与提醒"
        title="学习与提醒"
        description="把当前设备的提醒与界面偏好放在一个地方管理，不影响学习记录。"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr] xl:grid-cols-[320px_1fr]">
        {/* Left Column (Aside) */}
        <aside className="space-y-5">
          <Card variant="master" className="space-y-4">
            <CardHeader className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-teal-300">
                  设备作用域
                </span>
                <Badge tone="success">本地存储</Badge>
              </div>
              <CardTitle className="text-base flex items-center gap-2">
                <Laptop className="size-4 text-teal-400" />
                <span>当前设备偏好</span>
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3 pt-0 text-sm">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 space-y-1.5 text-xs text-zinc-300">
                <span className="text-zinc-500 block">偏好隔离原则</span>
                <p className="leading-relaxed">
                  显示密度、高对比主题与具体通知标题均保存在当前浏览器本地存储中，清除浏览器缓存后将恢复默认。
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs text-teal-300">
                <Bell className="size-4 shrink-0" />
                <span>前台显式提醒，不后台静默唤醒</span>
              </div>
            </CardContent>
          </Card>

          <Card variant="subtle" className="space-y-3">
            <CardHeader className="space-y-1">
              <CardTitle className="text-sm flex items-center gap-2">
                <Moon className="size-3.5 text-teal-300" />
                <span>提醒机制规范</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 pt-0 text-xs text-zinc-400">
              <p>• <strong className="text-zinc-300">复习到期：</strong>到达记忆曲线临界点时主动提醒。</p>
              <p>• <strong className="text-zinc-300">计划开始：</strong>当日滚动安排到达预定时间时提醒。</p>
              <p>• <strong className="text-zinc-300">晚间复盘：</strong>收口当日客观学习事实并沉淀行动。</p>
              <p>• <strong className="text-zinc-300">安静时段：</strong>允许跨午夜静音保护，避免打扰休息。</p>
            </CardContent>
          </Card>
        </aside>

        {/* Right Column (Main) */}
        <main className="space-y-6 min-w-0">
          <NotificationSettingsClient userId={user.id} initial={notificationPreferences} />
          <ExperienceSettingsClient />
        </main>
      </div>
    </PageFrame>
  );
}
