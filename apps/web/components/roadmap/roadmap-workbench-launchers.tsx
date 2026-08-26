import { ArrowRight, BarChart3, CheckSquare, ClipboardList, Flag, Inbox, Sparkles } from "lucide-react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface RoadmapWorkbenchLaunchersProps {
  milestonesCount?: number;
  stagesCount?: number;
}

const WORKBENCHS = [
  {
    href: "/roadmap/allocation",
    title: "投入安排",
    subtitle: "任务与排布",
    description: "把长期方向落成可开始的投入，任务只是上下文",
    icon: ClipboardList,
    accentTone: "teal",
  },
  {
    href: "/roadmap/allocation/drafts",
    title: "投入草稿",
    subtitle: "AI / 复盘草稿",
    description: "处理复盘、考试和 AI 生成的待确认投入草稿",
    icon: Inbox,
    accentTone: "amber",
  },
  {
    href: "/roadmap/stages",
    title: "阶段管理",
    subtitle: "里程碑与路线",
    description: "观察当前阶段、里程碑和待确认路线调整",
    icon: Flag,
    accentTone: "emerald",
  },
  {
    href: "/roadmap/reviews",
    title: "周期复盘",
    subtitle: "事实回看",
    description: "按周/月回看事实，再决定下一周期的动作",
    icon: BarChart3,
    accentTone: "cyan",
  },
] as const;

export function RoadmapWorkbenchLaunchers({
  milestonesCount,
  stagesCount,
}: RoadmapWorkbenchLaunchersProps) {
  return (
    <div className="space-y-3">
      {/* 4-Tile Compact Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {WORKBENCHS.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="block group min-w-0">
              <div className="rounded-xl border border-white/10 bg-[#0e1619]/90 p-3.5 transition-all duration-200 hover:border-teal-400/40 hover:bg-[#121c20] hover:shadow-[0_0_15px_rgba(45,212,191,0.12)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-teal-400/10 text-teal-300 transition-colors group-hover:bg-teal-400/20 group-hover:text-teal-200">
                      <Icon size={16} aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-xs font-semibold text-white group-hover:text-teal-200 transition-colors truncate">
                        {item.title}
                      </h3>
                      <span className="text-[10px] text-zinc-500 block truncate">{item.subtitle}</span>
                    </div>
                  </div>
                  <ArrowRight
                    size={14}
                    className="shrink-0 text-zinc-500 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-300 mt-1"
                    aria-hidden="true"
                  />
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-zinc-400 line-clamp-2">
                  {item.description}
                </p>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Confirmation Center Mini Card */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <CheckSquare size={14} />
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-medium text-white">统一确认中心</h4>
            <p className="text-[11px] text-zinc-400 truncate">
              报告、阶段建议、模拟考试、专项复测和 AI 草稿都在此完成最终决定
            </p>
          </div>
        </div>
        <ButtonLink className="shrink-0 text-xs py-1 px-3 h-8" href="/confirmations" variant="secondary" size="sm">
          打开确认中心 <ArrowRight size={13} aria-hidden="true" />
        </ButtonLink>
      </div>
    </div>
  );
}
