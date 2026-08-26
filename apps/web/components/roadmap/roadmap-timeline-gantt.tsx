import { Calendar, CheckCircle2, Clock, Flag, Milestone as MilestoneIcon, Sparkles } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/feedback";
import type { PlanMilestoneDto, StagePlanDto, WorkspaceSubjectDto } from "@/lib/contracts";
import {
  computeGanttTimeBounds,
  computeMilestoneGanttPoint,
  computeStageGanttSpan,
} from "./roadmap-gantt-utils";

export interface RoadmapTimelineGanttProps {
  stages: StagePlanDto[];
  milestones: PlanMilestoneDto[];
  subjects?: WorkspaceSubjectDto[];
}

function getStageModeLabel(mode: string): { label: string; tone: "info" | "success" | "warning" | "neutral" } {
  switch (mode) {
    case "strengthen":
      return { label: "强化突破", tone: "info" };
    case "sprint":
      return { label: "冲刺模考", tone: "warning" };
    case "recovery":
      return { label: "恢复调适", tone: "warning" };
    case "maintain":
    default:
      return { label: "基础推进", tone: "neutral" };
  }
}

export function RoadmapTimelineGantt({
  stages,
  milestones,
  subjects = [],
}: RoadmapTimelineGanttProps) {
  const activeStage = stages.find((s) => s.status === "active") || stages[0] || null;
  const activeMilestones = milestones.filter((m) => !m.archivedAt);
  const completedMilestonesCount = activeMilestones.filter((m) => m.status === "completed").length;

  const subjectMap = new Map<string, WorkspaceSubjectDto>();
  for (const sub of subjects) {
    subjectMap.set(sub.id, sub);
  }

  const now = new Date();
  const bounds = computeGanttTimeBounds(stages, activeMilestones, now);
  const stageSpans = stages.map((stage) => computeStageGanttSpan(stage, bounds, now));
  const milestonePoints = activeMilestones.map((m) => computeMilestoneGanttPoint(m, bounds, now));

  const modeInfo = activeStage ? getStageModeLabel(activeStage.mode) : { label: "未设阶段", tone: "neutral" as const };

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0e1619]/90 p-3.5 sm:p-4 text-zinc-100 shadow-xl backdrop-blur-md">
      {/* Header Info Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-teal-500/10 text-teal-300 border border-teal-500/20">
            <Flag size={16} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-white truncate">
                {activeStage ? activeStage.name : "长期阶段与里程碑甘特轴"}
              </h2>
              <Badge tone={modeInfo.tone}>{modeInfo.label}</Badge>
              {activeStage?.status === "active" && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300 border border-emerald-500/20">
                  <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  进行中
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-zinc-400 truncate">
              {activeStage?.goal ? activeStage.goal : "掌控长期推进节奏，阶段目标与里程碑关键路径可视化"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-1.5 text-zinc-300">
            <CheckCircle2 size={13} className="text-teal-400" />
            <span>里程碑: <strong className="text-white">{completedMilestonesCount}</strong>/{activeMilestones.length}</span>
          </div>
          <Link
            href="/roadmap/stages"
            className="rounded-lg border border-teal-500/30 bg-teal-500/10 px-2.5 py-1.5 text-xs font-medium text-teal-300 hover:bg-teal-500/20 transition-colors"
          >
            阶段管理 →
          </Link>
        </div>
      </div>

      {/* Gantt Timeline Track Container */}
      <div className="mt-3.5 space-y-2">
        {/* Timeline Range Indicator */}
        <div className="relative flex items-center justify-between text-[11px] font-mono text-zinc-500 px-1">
          <span>{bounds.formattedMinDate} 起始</span>
          {bounds.isNowInRange && (
            <div
              className="absolute -top-1 transform -translate-x-1/2 flex flex-col items-center pointer-events-none z-20"
              style={{ left: `${bounds.nowPositionPercent}%` }}
            >
              <span className="rounded bg-teal-500/20 border border-teal-400/40 px-1.5 py-0.2 text-[10px] font-semibold text-teal-300 shadow-sm backdrop-blur-sm whitespace-nowrap">
                ▲ 今日 ({now.getMonth() + 1}/{now.getDate()})
              </span>
            </div>
          )}
          <span>{bounds.formattedMaxDate} 节点</span>
        </div>

        {/* Horizontal Track Canvas */}
        <div className="relative h-20 w-full rounded-xl border border-white/5 bg-[#090d0f] p-1.5 overflow-hidden">
          {/* Grid lines */}
          <div className="absolute inset-0 grid grid-cols-4 pointer-events-none opacity-20 divide-x divide-white/10" />

          {/* Today vertical needle line */}
          {bounds.isNowInRange && (
            <div
              className="absolute top-0 bottom-0 w-px bg-gradient-to-b from-teal-400/80 via-teal-300 to-teal-500/20 z-10 pointer-events-none shadow-[0_0_8px_rgba(45,212,191,0.6)]"
              style={{ left: `${bounds.nowPositionPercent}%` }}
            />
          )}

          {/* Stage Blocks */}
          <div className="relative h-9 w-full flex items-center">
            {stageSpans.length > 0 ? (
              stageSpans.map((span) => {
                return (
                  <div
                    key={span.stage.id}
                    className={`absolute h-8 rounded-lg border transition-all duration-200 flex flex-col justify-center px-2 text-[11px] overflow-hidden ${
                      span.isCurrent
                        ? "border-teal-400/50 bg-teal-950/40 text-teal-100 shadow-[0_0_12px_rgba(20,184,166,0.15)] ring-1 ring-teal-400/20"
                        : span.isPast
                        ? "border-zinc-700/40 bg-zinc-800/30 text-zinc-400"
                        : "border-white/10 bg-white/[0.02] text-zinc-400 border-dashed"
                    }`}
                    style={{
                      left: `${span.leftPercent}%`,
                      width: `${span.widthPercent}%`,
                    }}
                    title={`${span.stage.name} (${span.startDateFormatted} ~ ${span.endDateFormatted}, 进度: ${span.progressPercent}%)`}
                  >
                    {/* Stage Internal Progress Bar */}
                    {span.isCurrent && (
                      <div
                        className="absolute inset-y-0 left-0 bg-teal-500/20 border-r border-teal-400/30 transition-all duration-300 pointer-events-none"
                        style={{ width: `${span.progressPercent}%` }}
                      />
                    )}
                    <div className="relative z-1 flex items-center justify-between gap-1 w-full truncate">
                      <span className="font-medium truncate">{span.stage.name}</span>
                      <span className="text-[10px] opacity-75 shrink-0">
                        {span.isCurrent ? `${span.progressPercent}%` : span.isPast ? "已结" : "待启"}
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-zinc-500">
                暂未设定阶段计划，点击右上角进入“阶段管理”创建。
              </div>
            )}
          </div>

          {/* Milestone Diamonds Line */}
          <div className="relative h-7 w-full">
            {milestonePoints.map((pt) => {
              const subject = pt.milestone.subjectId ? subjectMap.get(pt.milestone.subjectId) : null;
              return (
                <div
                  key={pt.milestone.id}
                  className="absolute top-1 transform -translate-x-1/2 flex flex-col items-center group cursor-pointer"
                  style={{ left: `${pt.positionPercent}%` }}
                  title={`${pt.milestone.stableKey}: ${pt.milestone.title} (${pt.targetDateFormatted}, ${
                    pt.isCompleted ? "已达成" : pt.daysUntil < 0 ? "已逾期" : `剩余 ${pt.daysUntil} 天`
                  })`}
                >
                  <div
                    className={`grid size-4 rotate-45 place-items-center rounded-[2px] border transition-transform group-hover:scale-125 ${
                      pt.isCompleted
                        ? "border-emerald-400 bg-emerald-500 text-black shadow-[0_0_8px_rgba(52,211,153,0.5)]"
                        : pt.isUrgent
                        ? "border-amber-400 bg-amber-500 text-black animate-pulse"
                        : pt.isPast
                        ? "border-rose-400/80 bg-rose-500/30 text-rose-200"
                        : "border-teal-400/60 bg-teal-950 text-teal-300"
                    }`}
                  >
                    <span className="-rotate-45 text-[8px] font-bold">
                      {pt.milestone.stableKey.slice(0, 2)}
                    </span>
                  </div>
                  <span className="mt-0.5 text-[9px] font-mono text-zinc-400 opacity-80 whitespace-nowrap">
                    {pt.targetDateFormatted}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Milestone Critical Path Quick List */}
        {activeMilestones.length > 0 && (
          <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1 pt-0.5 scrollbar-thin">
            <span className="text-[11px] font-medium text-zinc-400 shrink-0 flex items-center gap-1">
              <MilestoneIcon size={12} className="text-teal-400" />
              关键里程碑:
            </span>
            <div className="flex items-center gap-1.5 flex-nowrap">
              {activeMilestones.slice(0, 5).map((m) => {
                const isCompleted = m.status === "completed";
                const targetFormatted = m.targetDate ? m.targetDate.slice(5, 10) : "未定";
                return (
                  <div
                    key={m.id}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] whitespace-nowrap ${
                      isCompleted
                        ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
                        : "border-white/5 bg-white/[0.02] text-zinc-300 hover:border-white/10"
                    }`}
                  >
                    <span className="font-mono font-semibold text-teal-400">{m.stableKey}</span>
                    <span className="max-w-[120px] truncate text-zinc-200">{m.title}</span>
                    <span className="text-[10px] text-zinc-500 font-mono">({targetFormatted})</span>
                    {isCompleted ? (
                      <span className="text-[10px] text-emerald-400 font-medium">✓</span>
                    ) : (
                      <span className="size-1.5 rounded-full bg-teal-400" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
