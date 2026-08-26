import {
  BellRing,
  Bot,
  BriefcaseBusiness,
  ChevronRight,
  Database,
  MonitorCog,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { PageFrame, PageHeader } from "@/components/ui/page";
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
  const activeSubjectCount = subjects.filter((s) => !s.archivedAt).length;

  const sections = [
    {
      href: "/settings/exams",
      title: "考试与科目",
      description: activeWorkspace
        ? `${activeWorkspace.name} · ${activeSubjectCount} 个使用中科目`
        : "尚未建立考试工作区，需先初始化",
      Icon: BriefcaseBusiness,
      attention: !activeWorkspace,
      badge: activeWorkspace ? `${activeSubjectCount} 科目` : "待建立",
    },
    {
      href: "/settings/profile",
      title: "个人与恢复",
      description: "动机封存、恢复提醒与内容库管理",
      Icon: UserRound,
      badge: "隐私保护",
    },
    {
      href: "/settings/learning",
      title: "学习与提醒",
      description: "浏览器通知、时间窗、主题与显示体验",
      Icon: BellRing,
      badge: "本地偏好",
    },
    {
      href: "/settings/ai",
      title: "AI 与隐私",
      description: "Provider 配置、当前浏览器授权与数据边界",
      Icon: Bot,
      badge: "受控外呼",
    },
    {
      href: "/settings/data",
      title: "数据与安全",
      description: "学习树导入导出、备份边界与数据规范",
      Icon: Database,
      badge: "主状态源",
    },
    {
      href: "/settings/system",
      title: "系统与更新",
      description: "版本信息、运行指标与受控更新入口",
      Icon: MonitorCog,
      badge: "受控请求",
    },
  ] as const;

  return (
    <PageFrame variant="dashboard-wide" className="space-y-6">
      <PageHeader
        eyebrow="设置"
        title="设置总览"
        description="查看当前配置入口与需要优先处理的缺口。具体修改仍在各自的设置页面完成。"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr] xl:grid-cols-[320px_1fr]">
        {/* Left column: User profile and context summary */}
        <aside className="space-y-5">
          <Card variant="master" className="space-y-4">
            <CardHeader className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-teal-300">
                  当前账户
                </span>
                <Badge tone="success">已登录</Badge>
              </div>
              <CardTitle className="text-base break-all">{user.email}</CardTitle>
            </CardHeader>

            <CardContent className="space-y-3 pt-0 text-sm">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 space-y-1.5">
                <span className="text-xs text-zinc-400">活跃考试工作区</span>
                {activeWorkspace ? (
                  <div>
                    <strong className="block font-medium text-white">{activeWorkspace.name}</strong>
                    <span className="text-xs text-zinc-500">
                      {activeSubjectCount} 个科目
                      {activeWorkspace.targetExamDate
                        ? ` · 目标日 ${(activeWorkspace.targetExamDate instanceof Date ? activeWorkspace.targetExamDate.toISOString() : String(activeWorkspace.targetExamDate)).slice(0, 10)}`
                        : ""}
                    </span>
                  </div>
                ) : (
                  <div>
                    <span className="block font-medium text-amber-300">未设置工作区</span>
                    <span className="text-xs text-zinc-500">请前往“考试与科目”进行首次配置</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <ShieldCheck className="size-4 shrink-0 text-teal-400" />
                <span>隐私与安全策略全站受控</span>
              </div>
            </CardContent>
          </Card>
        </aside>

        {/* Right column: 2-column Master Entry Card grid */}
        <main className="space-y-6 min-w-0">
          <section aria-labelledby="settings-sections-title" className="space-y-4">
            <h2 id="settings-sections-title" className="sr-only">
              配置区域
            </h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {sections.map(({ href, title, description, Icon, badge, ...item }) => (
                <Link
                  key={href}
                  href={href}
                  className="group block min-w-0 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 rounded-2xl"
                >
                  <Card
                    variant="master"
                    className="h-full transition-all duration-200 hover:border-teal-400/40 hover:shadow-[0_0_20px_rgba(45,212,191,0.12)] group-hover:bg-[#10191d]/90"
                  >
                    <div className="flex items-start gap-4">
                      <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-teal-300 transition-colors group-hover:border-teal-400/30 group-hover:bg-teal-500/10">
                        <Icon size={20} aria-hidden="true" />
                      </div>

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <strong className="font-semibold text-white group-hover:text-teal-200 transition-colors">
                            {title}
                          </strong>
                          {"attention" in item && item.attention ? (
                            <Badge tone="warning">需要设置</Badge>
                          ) : (
                            <span className="text-[11px] text-zinc-500">{badge}</span>
                          )}
                        </div>

                        <CardDescription className="text-xs leading-relaxed text-zinc-400 line-clamp-2">
                          {description}
                        </CardDescription>
                      </div>

                      <ChevronRight
                        size={18}
                        className="mt-1 shrink-0 text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-300"
                        aria-hidden="true"
                      />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        </main>
      </div>
    </PageFrame>
  );
}
