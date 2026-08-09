import {
  BellRing,
  Bot,
  BriefcaseBusiness,
  ChevronRight,
  Database,
  MonitorCog,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { findActiveWorkspaceOrNull, listWorkspaceSubjects } from "@/lib/study/exam-workspace-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/settings");

export default async function SettingsIndexPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const activeWorkspace = await findActiveWorkspaceOrNull(user.id);
  const subjects = activeWorkspace ? await listWorkspaceSubjects(user.id, activeWorkspace.id) : [];
  const sections = [
    {
      href: "/settings/exams",
      title: "考试与科目",
      description: activeWorkspace
        ? `${activeWorkspace.name} · ${subjects.length} 个使用中科目`
        : "尚未建立考试工作区",
      Icon: BriefcaseBusiness,
      attention: !activeWorkspace,
    },
    { href: "/settings/profile", title: "个人与恢复", description: "动机封存、恢复提醒与内容库", Icon: UserRound },
    { href: "/settings/learning", title: "学习与提醒", description: "浏览器提醒、主题、密度与当前设备体验", Icon: BellRing },
    { href: "/settings/ai", title: "AI 与隐私", description: "Provider、当前浏览器授权与数据边界", Icon: Bot },
    { href: "/settings/data", title: "数据与安全", description: "学习树导入导出与恢复边界", Icon: Database },
    { href: "/settings/system", title: "系统与更新", description: "版本、健康状态与受控更新入口", Icon: MonitorCog },
  ] as const;

  return (
    <PageFrame variant="dashboard-wide" className="space-y-8">
      <PageHeader
        eyebrow="设置"
        title="设置总览"
        description="查看当前配置入口与需要优先处理的缺口。具体修改仍在各自的设置页面完成。"
      />
      <section className="space-y-4" aria-labelledby="settings-sections-title">
        <SectionHeader
          title="配置区域"
          description={activeWorkspace ? `当前账户：${user.email}` : "请先建立考试工作区，再进入今日行动。"}
        />
        <h2 id="settings-sections-title" className="sr-only">配置区域</h2>
        <ul className="divide-y divide-white/10 border-y border-white/10">
          {sections.map(({ href, title, description, Icon, ...item }) => (
            <li key={href}>
              <Link href={href} className="group flex min-h-20 min-w-0 items-center gap-4 py-4 text-left">
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-white/[0.04] text-zinc-400 group-hover:text-teal-200">
                  <Icon size={18} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <strong className="font-medium text-zinc-100 group-hover:text-teal-200">{title}</strong>
                    {"attention" in item && item.attention ? <span className="text-xs text-amber-300">需要设置</span> : null}
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-zinc-500">{description}</span>
                </span>
                <ChevronRight size={17} className="shrink-0 text-zinc-700 group-hover:text-teal-300" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </PageFrame>
  );
}
