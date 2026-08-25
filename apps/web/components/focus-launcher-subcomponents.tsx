import { Button } from "@/components/ui/button";
import { Flame, Clock, Target, TrendingUp, History, ListTodo } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FocusLauncherSummaryDto, StudyTaskDto, SubjectDto } from "@/lib/contracts";

export const FOCUS_DURATION_PRESETS: Array<{ label: string; value: number }> = [
  { label: "自由心流", value: 0 },
  { label: "25m 番茄", value: 25 },
  { label: "45m 专项", value: 45 },
  { label: "60m 强化", value: 60 },
  { label: "90m 深度", value: 90 },
];

export function useAnimatedMinutes(targetMinutes: number) {
  const [displayMinutes, setDisplayMinutes] = useState(targetMinutes);
  const prevRef = useRef(targetMinutes);

  useEffect(() => {
    const startVal = prevRef.current;
    const endVal = targetMinutes;
    if (startVal === endVal) return;

    const duration = 240; // 240ms smooth rolling interpolation
    const startTime = performance.now();

    let animId: number;
    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startVal + (endVal - startVal) * ease);
      setDisplayMinutes(current);

      if (progress < 1) {
        animId = requestAnimationFrame(tick);
      } else {
        setDisplayMinutes(endVal);
        prevRef.current = endVal;
      }
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [targetMinutes]);

  return displayMinutes;
}

export function TodayMomentumBar({ summary }: { summary?: FocusLauncherSummaryDto | null }) {
  const streak = summary?.streakDays ?? 1;
  const todayMinutes = summary?.todayMinutes ?? 0;
  const sessionsCount = summary?.todaySessionsCount ?? 0;

  const hours = Math.floor(todayMinutes / 60);
  const mins = todayMinutes % 60;
  const timeDisplay = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return (
    <div className="relative z-10 flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-xs font-medium text-zinc-300">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-orange-300 transition-transform hover:scale-105">
        <Flame className="size-3.5 fill-current" aria-hidden="true" />
        <span>连续备考 {streak} 天</span>
      </div>

      <div className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/20 bg-teal-500/10 px-3 py-1 text-teal-300 transition-transform hover:scale-105">
        <Clock className="size-3.5" aria-hidden="true" />
        <span>今日已专注 {timeDisplay}</span>
      </div>

      <div className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-indigo-300 transition-transform hover:scale-105">
        <Target className="size-3.5" aria-hidden="true" />
        <span>{sessionsCount} 次沉淀</span>
      </div>
    </div>
  );
}

export function SubjectIntelCard({
  selectedSubject,
  summary,
  tasks,
}: {
  selectedSubject: SubjectDto | null;
  summary?: FocusLauncherSummaryDto | null;
  tasks: StudyTaskDto[];
}) {
  if (!selectedSubject) {
    return (
      <div className="relative z-10 flex h-[112px] w-full max-w-lg shrink-0 flex-col items-center justify-center rounded-xl border border-white/5 bg-white/[0.02] p-3.5 text-center transition-all animate-[fade-in_0.2s_ease-out]">
        <p className="text-xs text-zinc-500">
          👈 在右侧选择科目，即刻载入该科目的投入战况与专属配置
        </p>
      </div>
    );
  }

  const accentColor = selectedSubject.color || "#2dd4bf";
  const stat = summary?.subjectWeeklyStats?.[selectedSubject.id];
  const weeklyMins = stat?.weeklyMinutes ?? 0;
  const weeklyH = Math.floor(weeklyMins / 60);
  const weeklyM = weeklyMins % 60;
  const weeklyDisplay = weeklyH > 0 ? `${weeklyH}h ${weeklyM}m` : `${weeklyM}m`;
  const lastAgo = stat?.lastSessionAgo ?? "本周暂无记录";
  const pendingTasks = tasks.filter((t) => t.subjectId === selectedSubject.id && t.status !== "done");

  return (
    <div
      key={selectedSubject.id}
      className="relative z-10 flex h-[112px] w-full max-w-lg shrink-0 flex-col justify-between rounded-xl border p-3 text-left transition-all duration-300 animate-[fade-in-up_0.25s_cubic-bezier(0.16,1,0.3,1)]"
      style={{
        borderColor: `${accentColor}33`,
        background: `linear-gradient(135deg, ${accentColor}08 0%, rgba(255,255,255,0.02) 100%)`,
      }}
    >
      <div className="flex items-center justify-between border-b border-white/5 pb-1.5">
        <div className="flex items-center gap-2 truncate">
          <span className="size-2 shrink-0 rounded-full ring-2 ring-white/10" style={{ backgroundColor: accentColor }} />
          <span className="truncate text-xs font-semibold text-white">【{selectedSubject.name}】战况速览</span>
        </div>
        <span className="shrink-0 text-[11px] font-mono text-zinc-400">
          {pendingTasks.length > 0 ? `${pendingTasks.length} 项待攻克` : "暂无待办"}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-black/20 px-2 py-1.5 transition-colors hover:bg-black/35">
          <div className="flex items-center justify-center gap-1 text-[10px] text-zinc-400">
            <TrendingUp className="size-3" style={{ color: accentColor }} />
            <span>本周投入</span>
          </div>
          <p className="mt-0.5 font-mono text-xs font-semibold text-zinc-200">{weeklyDisplay}</p>
        </div>

        <div className="rounded-lg bg-black/20 px-2 py-1.5 transition-colors hover:bg-black/35">
          <div className="flex items-center justify-center gap-1 text-[10px] text-zinc-400">
            <History className="size-3" style={{ color: accentColor }} />
            <span>上次学习</span>
          </div>
          <p className="mt-0.5 font-mono text-xs font-semibold text-zinc-200">{lastAgo}</p>
        </div>

        <div className="rounded-lg bg-black/20 px-2 py-1.5 transition-colors hover:bg-black/35">
          <div className="flex items-center justify-center gap-1 text-[10px] text-zinc-400">
            <ListTodo className="size-3" style={{ color: accentColor }} />
            <span>待办任务</span>
          </div>
          <p className="mt-0.5 font-mono text-xs font-semibold text-zinc-200">{pendingTasks.length} 项</p>
        </div>
      </div>
    </div>
  );
}

export function SubjectTileGrid({
  subjects,
  subjectId,
  onSelect,
  tasks,
}: {
  subjects: SubjectDto[];
  subjectId: string;
  onSelect: (id: string) => void;
  tasks: StudyTaskDto[];
}) {
  if (!subjects.length) return null;
  return (
    <div className="af-content-grid-two grid gap-2">
      {subjects.map((subject, idx) => {
        const isSelected = subject.id === subjectId;
        const pendingCount = tasks.filter((t) => t.subjectId === subject.id && t.status !== "done").length;
        const color = subject.color || "#2dd4bf";
        const isLastOdd = idx === subjects.length - 1 && subjects.length % 2 !== 0;

        return (
          <Button
            key={subject.id}
            type="button"
            onClick={() => onSelect(subject.id)}
            className={`group relative flex flex-col items-start justify-between rounded-xl border p-3 text-left transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] ${
              isLastOdd ? "af-content-span-all" : ""
            } ${
              isSelected
                ? "border-teal-400 bg-teal-500/10 shadow-[0_0_20px_rgba(45,212,191,0.18)] ring-1 ring-teal-400/50"
                : "border-white/10 bg-[var(--af-surface)] hover:border-white/20 hover:bg-[var(--af-surface-raised)] hover:shadow-md"
            }`}
          >
            <div className="flex w-full items-center justify-between gap-1.5">
              <span className="flex items-center gap-2 truncate">
                <span className="relative flex size-2 shrink-0 items-center justify-center">
                  {isSelected ? (
                    <span
                      className="absolute inline-flex size-full animate-ping rounded-full opacity-75"
                      style={{ backgroundColor: color }}
                    />
                  ) : null}
                  <span
                    className="relative inline-flex size-2 rounded-full ring-2 ring-white/10"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                </span>
                <span className={`truncate text-sm font-medium transition-colors ${isSelected ? "text-white font-semibold" : "text-zinc-200 group-hover:text-white"}`}>
                  {subject.name}
                </span>
              </span>
              {idx < 9 ? (
                <kbd className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] transition-all group-hover:scale-110 ${isSelected ? "border-teal-400/40 bg-teal-500/20 text-teal-200" : "border-white/10 bg-white/5 text-zinc-400"}`}>
                  {idx + 1}
                </kbd>
              ) : null}
            </div>
            {pendingCount > 0 ? (
              <span className="mt-1.5 text-[11px] text-zinc-400">
                {pendingCount} 个待办任务
              </span>
            ) : (
              <span className="mt-1.5 text-[11px] text-zinc-500">自由专注</span>
            )}
          </Button>
        );
      })}
    </div>
  );
}
