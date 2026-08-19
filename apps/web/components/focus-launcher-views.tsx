import { Clock, Minus, Plus, Sparkles, Infinity as InfinityIcon } from "lucide-react";
import { useCallback, useRef } from "react";
import type { FocusLauncherSummaryDto, StudyTaskDto, SubjectDto } from "@/lib/study/types";
import {
  FOCUS_DURATION_PRESETS,
  useAnimatedMinutes,
  TodayMomentumBar,
  SubjectIntelCard,
  SubjectTileGrid,
} from "./focus-launcher-subcomponents";

export {
  FOCUS_DURATION_PRESETS,
  useAnimatedMinutes,
  TodayMomentumBar,
  SubjectIntelCard,
  SubjectTileGrid,
};

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

  // Animated smooth minutes interpolation
  const animatedMinutes = useAnimatedMinutes(durationPreset);

  // Circular gauge math based on 120min standard dial scale
  const maxMinutes = 120;
  const progressRatio = durationPreset <= 0 ? 0 : Math.min(durationPreset / maxMinutes, 1);
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - progressRatio * circumference;

  // Mechanical pointer angle (0 min = 0 deg / 12 o'clock, 120 min = 360 deg)
  const needleAngle = durationPreset <= 0 ? 0 : (durationPreset / 120) * 360;

  // Calculate dynamic expected completion time string (e.g. 14:35)
  const calculateExpectedTime = useCallback(() => {
    if (durationPreset <= 0) return "正向心流 · 无上限";
    const now = new Date();
    const target = new Date(now.getTime() + durationPreset * 60 * 1000);
    const hh = String(target.getHours()).padStart(2, "0");
    const mm = String(target.getMinutes()).padStart(2, "0");
    return `预计将在 ${hh}:${mm} 完成`;
  }, [durationPreset]);

  const expectedTimeStr = calculateExpectedTime();

  // Helper to convert mouse/touch angle into 5-minute stepped duration
  const updateDurationFromAngle = useCallback(
    (clientX: number, clientY: number) => {
      if (!dialRef.current) return;
      const rect = dialRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = clientX - centerX;
      const dy = clientY - centerY;

      // Distance from center to avoid tiny jitters at absolute center
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 18) return;

      // Compute angle in radians where top (12 o'clock) is 0 deg
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      if (deg < 0) deg += 360;

      // Map 360 deg to 120 mins -> 1 deg = 1/3 min
      const rawMinutes = (deg / 360) * 120;

      // Snap to nearest 5 minutes
      let steppedMinutes = Math.round(rawMinutes / 5) * 5;
      if (steppedMinutes < 0) steppedMinutes = 0;
      if (steppedMinutes > 120) steppedMinutes = 120;

      onPresetChange(steppedMinutes);
    },
    [onPresetChange]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    updateDurationFromAngle(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    updateDurationFromAngle(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handleMinus = () => {
    if (durationPreset <= 0) return;
    if (durationPreset <= 5) {
      onPresetChange(0);
    } else {
      onPresetChange(durationPreset - 5);
    }
  };

  const handlePlus = () => {
    if (durationPreset >= 180) return;
    if (durationPreset === 0) {
      onPresetChange(25);
    } else {
      onPresetChange(durationPreset + 5);
    }
  };

  return (
    <section className="relative flex min-h-[34rem] flex-col items-center justify-between overflow-y-auto rounded-2xl border border-white/10 bg-[var(--af-surface-subtle)] p-4 text-center select-none sm:p-5 lg:p-6 min-[1200px]:col-span-7 min-[1200px]:h-full min-[1200px]:min-h-0 min-[1200px]:overflow-hidden">
      {/* Ambient decorative background glow with breathing pulse */}
      <div
        className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 size-[36rem] rounded-full blur-[100px] animate-[glow-pulse_4s_ease-in-out_infinite_alternate]"
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
            className="group/dial relative grid size-48 sm:size-56 md:size-64 lg:size-68 xl:size-72 place-items-center rounded-full border bg-[var(--af-surface)] transition-all duration-300 cursor-grab active:cursor-grabbing overflow-visible touch-none"
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
