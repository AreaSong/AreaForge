import { ArrowRight, BarChart3, ClipboardList, Flag, Inbox } from "lucide-react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap");

const WORKBENCHS = [
  { href: "/roadmap/allocation", title: "投入安排", description: "把长期方向落成可开始的投入，任务只是上下文，不替代学习结果。", icon: ClipboardList },
  { href: "/roadmap/allocation/drafts", title: "投入草稿", description: "处理复盘、考试和 AI 生成的待确认投入草稿。", icon: Inbox },
  { href: "/roadmap/stages", title: "阶段", description: "观察当前阶段、里程碑和待确认调整。", icon: Flag },
  { href: "/roadmap/reviews", title: "周期复盘", description: "按周/月回看事实，再决定下一周期的动作。", icon: BarChart3 },
] as const;

export default function RoadmapOverviewPage() {
  return (
    <PageFrame variant="dashboard-wide">
      <PageHeader
        eyebrow="路线"
        title="长期路线"
        description="从当前事实判断下一步，不把计划本身当成学习成果。"
      />
      <section className="space-y-4">
        <SectionHeader title="路线工作台" description="四个视图共享同一套路线状态，详情页沿用这里的二级导航。" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {WORKBENCHS.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className="block group">
                <Card variant="master" className="flex min-h-32 items-start justify-between gap-4 p-5 transition-all duration-200 group-hover:border-teal-400/40 group-hover:shadow-[0_0_20px_rgba(45,212,191,0.15)]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5 text-teal-300">
                      <div className="grid size-8 place-items-center rounded-lg bg-teal-400/10 text-teal-300 transition-colors group-hover:bg-teal-400/20">
                        <Icon size={18} aria-hidden="true" />
                      </div>
                      <h2 className="text-base font-semibold text-white transition-colors group-hover:text-teal-200">{item.title}</h2>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-zinc-400">{item.description}</p>
                  </div>
                  <ArrowRight size={17} className="mt-1 shrink-0 text-zinc-500 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-teal-300" aria-hidden="true" />
                </Card>
              </Link>
            );
          })}
        </div>
      </section>
      <section className="pt-2">
        <Card variant="subtle" className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white">统一确认中心</h2>
            <p className="mt-1 text-sm text-zinc-400">报告、阶段建议、模拟考试、专项复测和 AI 草稿都在这里完成最终决定。</p>
          </div>
          <ButtonLink className="shrink-0" href="/confirmations" variant="secondary" size="md">
            打开确认中心<ArrowRight size={15} aria-hidden="true" />
          </ButtonLink>
        </Card>
      </section>
    </PageFrame>
  );
}
