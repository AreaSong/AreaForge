import { Bell, Bot, BriefcaseBusiness, MonitorCog, SlidersHorizontal, UserRound } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { getAiDraftRuntimeStatus } from "@/lib/study/ai-draft-status";
import { readAiProviderPreference } from "@/lib/study/ai-provider-preference";
import { findActiveWorkspaceOrNull, listWorkspaceSubjects } from "@/lib/study/exam-workspace-service";
import { listMotivationItems } from "@/lib/study/motivation-library-service";
import { getNotificationPreferences } from "@/lib/study/notification-preferences-service";
import { getMotivationVault } from "@/lib/study/service";
import { getUpdateCenterStatus } from "@/lib/system/update-center";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/settings");

export default async function SettingsIndexPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const activeWorkspace = await findActiveWorkspaceOrNull(user.id);
  const [subjects, vault, motivationItems, notifications, updateStatus] = await Promise.all([
    activeWorkspace ? listWorkspaceSubjects(user.id, activeWorkspace.id) : Promise.resolve([]),
    getMotivationVault(),
    listMotivationItems(user.id, true),
    getNotificationPreferences(user.id),
    getUpdateCenterStatus(),
  ]);
  const aiStatus = await getAiDraftRuntimeStatus();
  const aiPreference = readAiProviderPreference(await cookies());
  const vaultFieldCount = vault ? [vault.whyStarted, vault.neverReturnTo, vault.futureSelf, vault.messageToFuture, vault.firstSimulationDiary].filter(Boolean).length : 0;
  const enabledNotificationCount = [notifications.reviewDueEnabled, notifications.planStartEnabled, notifications.eveningReviewEnabled].filter(Boolean).length;
  const version = updateStatus.currentVersion.startsWith("v") ? updateStatus.currentVersion : `v${updateStatus.currentVersion}`;

  const items = [
    { href: "/settings/workspace", title: "工作区", description: "考试目标、科目与分组", status: activeWorkspace ? `${activeWorkspace.name} · ${subjects.filter((item) => !item.archivedAt).length} 个科目` : "尚未建立", tone: activeWorkspace ? "success" : "warning", icon: BriefcaseBusiness },
    { href: "/settings/profile", title: "档案与动机", description: "封存长期动机并管理恢复内容", status: vaultFieldCount || motivationItems.length ? `${vaultFieldCount} 项封存 · ${motivationItems.filter((item) => !item.archivedAt).length} 条内容` : "可选配置", tone: vaultFieldCount ? "success" : "neutral", icon: UserRound },
    { href: "/settings/notifications", title: "通知", description: "复习、计划与晚间复盘提醒", status: `${enabledNotificationCount} / 3 类提醒启用`, tone: enabledNotificationCount ? "info" : "neutral", icon: Bell },
    { href: "/settings/ai", title: "AI", description: "外部 Provider 与草稿数据边界", status: !aiStatus.effectiveEnabled ? (aiStatus.serverEnabled ? "Web 全局开关已关闭" : "服务端未启用") : aiPreference.externalProviderEnabled ? "当前浏览器已启用" : "当前浏览器已关闭", tone: aiStatus.effectiveEnabled && aiPreference.externalProviderEnabled ? "success" : "neutral", icon: Bot },
    { href: "/settings/experience", title: "体验", description: "主题、密度与界面偏好", status: "当前设备偏好", tone: "neutral", icon: SlidersHorizontal },
    { href: "/settings/system", title: "系统", description: "版本、更新与运行状态", status: version, tone: updateStatus.blocker ? "warning" : "success", icon: MonitorCog },
  ] as const;

  return (
    <PageFrame variant="dashboard-wide">
      <PageHeader title="设置" eyebrow="控制中心" description="先保证考试工作区和科目可用，再按需配置提醒、AI、体验与系统。" action={activeWorkspace ? <ButtonLink href="/today" variant="primary">返回今日行动</ButtonLink> : undefined} />
      {!activeWorkspace ? <Alert tone="warning" title="第一步：建立考试工作区" action={<ButtonLink href="/settings/workspace?setup=1" variant="primary" size="sm">开始设置</ButtonLink>}>没有工作区时，计划、知识、复盘和阶段数据无法确定归属。</Alert> : null}
      <section className="space-y-3">
        <SectionHeader title="配置状态" description="每项设置独立保存；进入后只处理对应范围。" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className="group flex min-h-36 flex-col justify-between rounded-md border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-white/20 hover:bg-white/[0.04]">
                <div><div className="flex items-center gap-2"><Icon className="h-4 w-4 text-teal-300" aria-hidden="true" /><h2 className="font-medium text-white group-hover:text-teal-200">{item.title}</h2></div><p className="mt-2 text-sm leading-6 text-zinc-400">{item.description}</p></div>
                <div className="mt-4 flex items-center justify-between gap-3"><Badge tone={item.tone}>{item.status}</Badge><span className="text-xs text-zinc-500 group-hover:text-zinc-300">打开</span></div>
              </Link>
            );
          })}
        </div>
      </section>
    </PageFrame>
  );
}
