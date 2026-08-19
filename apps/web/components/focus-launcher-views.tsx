import { Flame, Clock, Target, TrendingUp, History, ListTodo, Minus, Plus, Sparkles, Infinity as InfinityIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FocusLauncherSummaryDto, StudyTaskDto, SubjectDto } from "@/lib/study/types";

export const FOCUS_DURATION_PRESETS: Array<{ label: string; value: number }> = [
  { label: "自由心流", value: 0 },
  { label: "25m 番茄", value: 25 },
  { label: "45m 专项", value: 45 },
  { label: "60m 强化", value: 60 },
  { label: "90m 深度", value: 90 },
];

function useAnimatedMinutes(targetMinutes: number) {
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
      // easeOutCubic
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

export function FocusHeroDial({
  selectedSubject,
  summary,
  durationPreset,
  onPresetChange,
  tasks,
}: {
  selectedSubject: SubjectDto | null;
  summary?: FocusLauncherSummaryDto | null;
  durationPreset: number;
  onPresetChange: (preset: number) => void;
  tasks: StudyTaskDto[];
}) {
  const accentColor = selectedSubject?.color || "#2dd4bf";
  const dialRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Animated numbers for smooth transitions
  const animatedMinutes = useAnimatedMinutes(durationPreset);

  // Continuous Seamless Ring Parameters (Radius = 42, Circumference ≈ 263.89)
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const progressRatio = durationPreset === 0 ? 0 : Math.min(1, durationPreset / 60);
  const strokeDashoffset = circumference * (1 - progressRatio);
  const needleAngle = durationPreset === 0 ? 0 : (durationPreset / 60) * 360;

  // Expected Completion Time Calculation (Updated dynamically every 10s)
  const [expectedTimeStr, setExpectedTimeStr] = useState("");
  useEffect(() => {
    const updateExpected = () => {
      if (durationPreset === 0) {
        setExpectedTimeStr("正向心流 · 无上限");
        return;
      }
      const targetDate = new Date(Date.now() + durationPreset * 60 * 1000);
      const hh = String(targetDate.getHours()).padStart(2, "0");
      const mm = String(targetDate.getMinutes()).padStart(2, "0");
      setExpectedTimeStr(`预计将在 ${hh}:${mm} 完成`);
    };
    updateExpected();
    const interval = setInterval(updateExpected, 10000);
    return () => clearInterval(interval);
  }, [durationPreset]);

  // Direct Dial Scrubbing & Drag Handler
  const handlePointerScrub = useCallback((clientX: number, clientY: number) => {
    const el = dialRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;

    // Angle starting from 12 o'clock (0° / 360°)
    let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (angleDeg < 0) angleDeg += 360;

    // Map 360° to 60 minutes, snap to 5m increments
    let mins = Math.round((angleDeg / 360) * 60);
    mins = Math.round(mins / 5) * 5;
    if (mins === 0 && angleDeg > 330) mins = 60;
    onPresetChange(mins);
  }, [onPresetChange]);

  const handlePointerDown = (e: React.PointerEvent) => {
    isDraggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    handlePointerScrub(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    handlePointerScrub(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isDraggingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  // Native non-passive wheel handler to prevent page scroll while wheeling over clock
  useEffect(() => {
    const el = dialRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 5 : -5;
      onPresetChange(Math.max(0, Math.min(180, durationPreset + delta)));
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [durationPreset, onPresetChange]);

  const handleMinus = () => {
    onPresetChange(Math.max(0, durationPreset - 5));
  };

  const handlePlus = () => {
    onPresetChange(Math.min(180, durationPreset + 5));
  };

  return (
    <section className="relative flex h-full min-h-0 flex-col items-center justify-between overflow-y-auto lg:overflow-hidden rounded-2xl border border-white/10 bg-[var(--af-surface-subtle)] p-4 sm:p-5 lg:p-6 text-center lg:col-span-7 select-none">
      {/* Ambient decorative background glow with breathing pulse */}
      <div
        className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 size-[36rem] rounded-full blur-[100px] transition-all duration-700 animate-[glow-pulse_4s_ease-in-out_infinite_alternate]"
        style={{
          background: selectedSubject
            ? `radial-gradient(circle, ${accentColor} 0%, transparent 70%)`
            : "radial-gradient(circle, rgba(45,212,191,0.3) 0%, transparent 70%)",
        }}
        aria-hidden="true"
      />

      {/* Top Momentum Metrics Bar */}
      <TodayMomentumBar summary={summary} />

      {/* Dial Center Stage with Left/Right Stepper Controls & Drag Scrubbing */}
      <div className="relative z-10 my-auto flex flex-col items-center justify-center py-2">
        <div className="flex items-center justify-center gap-3 sm:gap-5 md:gap-6">
          {/* Left Stepper Button: -5m */}
          <button
            type="button"
            onClick={handleMinus}
            disabled={durationPreset <= 0}
            className="group relative flex size-9 sm:size-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-400 transition-all hover:border-white/25 hover:bg-white/10 hover:text-white active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
            title="减少 5 分钟 (按 ← 或 [ )"
            aria-label="减少 5 分钟"
          >
            <Minus className="size-4 transition-transform group-hover:scale-110" />
          </button>

          {/* Dial Container (Supports Wheel & Direct Drag/Click Scrubbing) */}
          <div
            ref={dialRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="group/dial relative grid size-48 sm:size-56 md:size-64 lg:size-68 xl:size-72 place-items-center rounded-full border bg-[var(--af-surface)] transition-all duration-500 cursor-grab active:cursor-grabbing overflow-visible touch-none"
            style={{
              borderColor: selectedSubject ? `${accentColor}33` : "rgba(255,255,255,0.1)",
              boxShadow: selectedSubject
                ? `0 0 28px ${accentColor}15, 0 12px 40px rgba(0,0,0,0.5)`
                : "0 12px 40px rgba(0,0,0,0.5)",
            }}
            title="可滑动滚轮、左右按键或直接在表盘上拖动划选设定时长"
          >
            {/* SVG Dial: 100% Pure Circular Vectors */}
            <svg className="absolute inset-0 size-full -rotate-90 p-4 text-white/20 pointer-events-none overflow-visible" viewBox="0 0 100 100" aria-hidden="true">
              {/* 1. Continuous Base Track Circle */}
              <circle
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="3.5"
              />

              {/* 2. Free Flow Ambient Rotating Aura (Only in 0m Flow State) */}
              {durationPreset === 0 ? (
                <circle
                  cx="50"
                  cy="50"
                  r={radius}
                  fill="none"
                  stroke={selectedSubject ? accentColor : "#2dd4bf"}
                  strokeWidth="2.5"
                  strokeDasharray="4 8"
                  className="animate-[spin_16s_linear_infinite] origin-center opacity-40"
                />
              ) : null}

              {/* 3. Circular Vector Glow Arc */}
              {durationPreset > 0 ? (
                <circle
                  cx="50"
                  cy="50"
                  r={radius}
                  fill="none"
                  stroke={selectedSubject ? accentColor : "#2dd4bf"}
                  strokeWidth="8"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  className="transition-all duration-500 ease-out"
                  style={{
                    opacity: 0.25,
                  }}
                />
              ) : null}

              {/* 4. Active Target Progress Arc */}
              <circle
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={selectedSubject ? accentColor : "#2dd4bf"}
                strokeWidth="3.5"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-500 ease-out"
                style={{
                  opacity: durationPreset > 0 ? 1 : 0,
                }}
              />

              {/* 5. Inner Hour Ticks */}
              {Array.from({ length: 12 }).map((_, i) => {
                const angle = (i * 30 * Math.PI) / 180;
                const x1 = 50 + 35 * Math.cos(angle);
                const y1 = 50 + 35 * Math.sin(angle);
                const x2 = 50 + (i % 3 === 0 ? 30 : 32) * Math.cos(angle);
                const y2 = 50 + (i % 3 === 0 ? 30 : 32) * Math.sin(angle);
                return (
                  <line
                    key={i}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={i % 3 === 0 ? (selectedSubject ? accentColor : "#2dd4bf") : "rgba(255,255,255,0.2)"}
                    strokeWidth={i % 3 === 0 ? "1.5" : "0.75"}
                    strokeLinecap="round"
                    className="transition-colors duration-300"
                  />
                );
              })}

              {/* 6. Mechanical Pointer (Hidden in 0m flow state) */}
              <line
                x1="50"
                y1="50"
                x2="50"
                y2="18"
                stroke={selectedSubject ? accentColor : "#2dd4bf"}
                strokeWidth="1.5"
                strokeLinecap="round"
                style={{
                  transformOrigin: "50px 50px",
                  transform: `rotate(${needleAngle}deg)`,
                  opacity: durationPreset === 0 ? 0.3 : 1,
                  transition: "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), stroke 0.3s ease, opacity 0.3s ease",
                }}
              />
              {/* Center Pivot Point */}
              <circle
                cx="50"
                cy="50"
                r="2.5"
                fill={selectedSubject ? accentColor : "#2dd4bf"}
                className="transition-colors duration-500"
              />
            </svg>

            {/* Dial Center Stage: Flow Mode vs Countdown Mode */}
            <div className="relative z-10 flex flex-col items-center pointer-events-none">
              {durationPreset === 0 ? (
                <div className="flex flex-col items-center animate-[fade-in_0.3s_ease-out]">
                  <div className="flex items-center gap-1.5 text-3xl sm:text-4xl lg:text-5xl font-semibold text-white">
                    <InfinityIcon className="size-8 sm:size-10 text-teal-300" />
                    <span className="font-mono tracking-tight text-2xl sm:text-3xl">心流</span>
                  </div>
                  <p className="mt-1 text-xs font-medium text-zinc-400">
                    {selectedSubject ? "按 Enter 即刻启程" : "请在右侧选择科目"}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center animate-[fade-in_0.3s_ease-out]">
                  <p className="font-mono text-4xl sm:text-5xl lg:text-6xl font-semibold tabular-nums text-white tracking-tight">
                    {`${String(animatedMinutes).padStart(2, "0")}:00`}
                  </p>
                  <p className="mt-1 text-xs sm:text-sm font-medium text-zinc-400">
                    {selectedSubject ? "按 Enter 即刻启程" : "请在右侧选择科目"}
                  </p>
                </div>
              )}

              {/* Dynamic Expected Completion Time Badge */}
              <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-0.5 text-[10px] font-mono text-zinc-300 border border-white/5">
                <Clock className="size-2.5 text-teal-300" />
                <span>{expectedTimeStr}</span>
              </div>
            </div>
          </div>

          {/* Right Stepper Button: +5m */}
          <button
            type="button"
            onClick={handlePlus}
            disabled={durationPreset >= 180}
            className="group relative flex size-9 sm:size-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-400 transition-all hover:border-white/25 hover:bg-white/10 hover:text-white active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
            title="增加 5 分钟 (按 → 或 ] )"
            aria-label="增加 5 分钟"
          >
            <Plus className="size-4 transition-transform group-hover:scale-110" />
          </button>
        </div>

        {/* Focus Duration Preset Selector */}
        <div className="mt-3.5 flex flex-wrap items-center justify-center gap-1.5">
          {FOCUS_DURATION_PRESETS.map((preset) => {
            const isSelected = durationPreset === preset.value;
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() => onPresetChange(preset.value)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  isSelected
                    ? "border border-teal-400/40 bg-teal-500/15 text-teal-200 font-semibold"
                    : "border border-white/5 bg-white/5 text-zinc-400 hover:border-white/15 hover:text-zinc-200"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        {/* Subtle Keyboard Guide Hints */}
        <div className="mt-2.5 flex items-center justify-center gap-2 text-[10px] text-zinc-500">
          <span>
            <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[9px] text-zinc-400">1~{Math.min(tasks.length ? 7 : 7, 7)}</kbd> 选科目
          </span>
          <span>·</span>
          <span>
            <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[9px] text-zinc-400">←/→</kbd> 调时
          </span>
          <span>·</span>
          <span>
            <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[9px] text-zinc-400">Enter</kbd> 启程
          </span>
        </div>
      </div>

      {/* Bottom Subject Intel Card */}
      <SubjectIntelCard selectedSubject={selectedSubject} summary={summary} tasks={tasks} />
    </section>
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
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {subjects.map((subject, idx) => {
        const isSelected = subject.id === subjectId;
        const pendingCount = tasks.filter((t) => t.subjectId === subject.id && t.status !== "done").length;
        const color = subject.color || "#2dd4bf";
        const isLastOdd = idx === subjects.length - 1 && subjects.length % 2 !== 0;

        return (
          <button
            key={subject.id}
            type="button"
            onClick={() => onSelect(subject.id)}
            className={`group relative flex flex-col items-start justify-between rounded-xl border p-3 text-left transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] ${
              isLastOdd ? "sm:col-span-2" : ""
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
          </button>
        );
      })}
    </div>
  );
}
