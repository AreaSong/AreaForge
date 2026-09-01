"use client";

import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  CalendarCheck2,
  ChartNoAxesCombined,
  CheckCircle2,
  CircleHelp,
  Clock3,
  FileCheck2,
  Inbox,
  ListChecks,
  NotebookPen,
  RotateCcw,
  Target,
  type LucideIcon,
} from "lucide-react";
import {
  JOURNEY_STEPS,
  JourneyTimeline,
  type JourneyStepId,
} from "./journey-timeline";

const STEP_BADGES: Record<JourneyStepId, string> = {
  start: "先明确边界",
  focus: "本地优先",
  closeout: "形成记录",
  evidence: "需要复测",
  today: "只留下一步",
  adjust: "由你确认",
};

export function ShowcaseStage() {
  const [activeStep, setActiveStep] = useState<JourneyStepId>("start");
  const currentStep = JOURNEY_STEPS.find((step) => step.id === activeStep) ?? JOURNEY_STEPS[0];

  return (
    <section
      aria-labelledby="learning-loop-title"
      className="relative overflow-hidden rounded-[1.75rem] border border-white/[0.08] bg-[#0d1515]/80 p-5 shadow-[0_30px_90px_rgba(0,0,0,0.36)] backdrop-blur-xl sm:p-7 lg:min-h-[540px] lg:p-6"
    >
      <div aria-hidden className="absolute -right-24 -top-28 size-80 rounded-full bg-teal-300/[0.07] blur-3xl" />
      <div aria-hidden className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-teal-200/45 to-transparent" />

      <div className="relative">
        <div className="inline-flex items-center gap-2 rounded-full border border-teal-200/15 bg-teal-200/[0.05] px-3 py-1 text-xs font-medium text-teal-200">
          <span aria-hidden className="size-1.5 rounded-full bg-teal-300" />
          AreaForge 学习行动中心
        </div>
        <h2
          className="mt-4 max-w-2xl text-2xl font-semibold leading-tight tracking-[-0.025em] text-white sm:text-3xl lg:text-[2rem]"
          id="learning-loop-title"
        >
          把每次学习投入，沉淀成下一步行动
        </h2>
        <p className="mt-3 hidden max-w-2xl text-sm leading-6 text-zinc-400 sm:block sm:text-[15px]">
          从选科目开始，经过专注、收口与复测，最终回到今天真正需要完成的事情。任务和考纲是上下文，是否学进去才是结果。
        </p>

        <JourneyTimeline activeStep={activeStep} onStepChange={setActiveStep} />

        <section
          aria-label={`${currentStep.label}内容预览`}
          aria-live="polite"
          aria-labelledby={`learning-loop-tab-${activeStep}`}
          className="mt-4 min-h-[508px] rounded-2xl border border-teal-200/15 bg-[#081211]/85 p-4 sm:mt-5 sm:min-h-[320px] sm:p-5 lg:min-h-[336px] xl:min-h-[304px]"
          id="learning-loop-panel"
          role="tabpanel"
          tabIndex={0}
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.07] pb-3">
            <div>
              <p className="text-xs font-medium text-zinc-400">工作流预览 · {currentStep.label}</p>
              <p className="mt-1 text-[11px] text-zinc-600">点击上方步骤，查看这一环如何承接真实学习记录。</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-300/[0.09] px-2.5 py-1 text-[11px] text-teal-200">
              <span aria-hidden className="size-1.5 rounded-full bg-teal-300" />
              {STEP_BADGES[activeStep]}
            </span>
          </div>

          <div className="pt-4">
            <StepPreview step={activeStep} />
          </div>
        </section>

        <div className="mt-4 hidden items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3.5 py-3 text-xs text-zinc-400 sm:flex lg:hidden sm:text-sm">
          <CheckCircle2 aria-hidden className="size-4 shrink-0 text-teal-300" />
          <span>今天做什么、学到了什么、接下来验证什么，都在同一条学习闭环里。</span>
        </div>
      </div>
    </section>
  );
}

function StepPreview({ step }: { step: JourneyStepId }) {
  switch (step) {
    case "start":
      return <StartPreview />;
    case "focus":
      return <FocusStepPreview />;
    case "closeout":
      return <CloseoutPreview />;
    case "evidence":
      return <EvidencePreview />;
    case "today":
      return <TodayPreview />;
    case "adjust":
      return <AdjustmentPreview />;
  }
}

function StartPreview() {
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
        <p className="text-[11px] text-zinc-500">今天从哪里开始</p>
        <div className="mt-3 flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-lg bg-teal-300/[0.1] text-teal-200">
            <Target aria-hidden className="size-4" />
          </span>
          <div>
            <p className="text-[11px] text-zinc-500">当前科目</p>
            <h3 className="text-base font-medium text-white">高等数学</h3>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="可选科目示例">
          <span className="rounded-lg border border-teal-200/30 bg-teal-200/[0.08] px-2.5 py-1.5 text-[11px] text-teal-100">高等数学</span>
          <span className="rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-[11px] text-zinc-500">数据结构</span>
          <span className="rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-[11px] text-zinc-500">英语</span>
        </div>
      </div>

      <PreviewNote icon={ListChecks} label="本次学习边界">
        <h3 className="text-base font-medium text-white">多元函数极值</h3>
        <p className="mt-1 text-sm leading-5 text-zinc-400">概念理解与例题演算</p>
        <div className="mt-4 space-y-2 border-t border-white/[0.07] pt-3 text-xs text-zinc-400">
          <p className="flex items-start gap-2">
            <CheckCircle2 aria-hidden className="mt-0.5 size-3.5 shrink-0 text-teal-300" />
            先选科目，再进入大计时器
          </p>
          <p className="flex items-start gap-2">
            <BookOpenCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-teal-300" />
            任务与考纲作为可选上下文补充
          </p>
        </div>
      </PreviewNote>
    </div>
  );
}

function FocusStepPreview() {
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-6">
      <FocusPreview />
      <div className="min-w-0">
        <p className="text-xs text-zinc-500">本次学习</p>
        <h3 className="mt-1 text-lg font-semibold text-white">高等数学 · 多元函数极值</h3>
        <p className="mt-1 text-sm leading-5 text-zinc-400">在一个明确边界内持续投入，结束后进入学习收口。</p>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full bg-teal-300/[0.09] px-2.5 py-1 text-teal-200">本地优先</span>
          <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-zinc-400">单一活动</span>
          <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-zinc-400">结束后收口</span>
        </div>
        <p className="mt-4 flex items-start gap-2 border-t border-white/[0.07] pt-3 text-xs leading-5 text-zinc-500">
          <Clock3 aria-hidden className="mt-0.5 size-3.5 shrink-0 text-teal-300" />
          计时只是投入记录，收口和产出才会进入后续证据链。
        </p>
      </div>
    </div>
  );
}

function FocusPreview() {
  return (
    <div className="relative grid size-28 shrink-0 place-items-center rounded-full bg-teal-300/[0.035] sm:size-36">
      <div aria-hidden className="af-login-focus-orbit absolute inset-0 rounded-full border border-teal-200/15 border-t-teal-200/70" />
      <div aria-hidden className="absolute inset-2 rounded-full border border-teal-200/10 bg-[#0a1716] shadow-[inset_0_0_30px_rgba(45,212,191,0.05),0_0_32px_rgba(45,212,191,0.06)] sm:inset-3" />
      <div className="relative text-center">
        <Clock3 aria-hidden className="mx-auto size-4 text-teal-300" />
        <strong className="mt-2 block text-2xl font-semibold tabular-nums tracking-[-0.04em] text-white sm:text-3xl">42:18</strong>
        <span className="mt-1 block text-[11px] text-zinc-500">专注进行中</span>
      </div>
    </div>
  );
}

function CloseoutPreview() {
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        <PreviewField icon={CheckCircle2} label="学到了什么">
          能说明条件极值的使用边界
        </PreviewField>
        <PreviewField icon={NotebookPen} label="最小产出">
          例题步骤已整理为知识卡片
        </PreviewField>
        <PreviewField icon={CircleHelp} label="遗留问题">
          多约束条件仍需独立复测
        </PreviewField>
      </div>
      <p className="mt-3 flex items-start gap-2 border-t border-white/[0.07] pt-3 text-xs leading-5 text-zinc-500">
        <NotebookPen aria-hidden className="mt-0.5 size-3.5 shrink-0 text-teal-300" />
        学习收口把“我看过了”变成可复核的结果，并保留下一次行动。
      </p>
    </div>
  );
}

function EvidencePreview() {
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-stretch">
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-zinc-500">知识点</p>
          <span className="rounded-full bg-teal-300/[0.09] px-2 py-1 text-[10px] text-teal-200">证据已关联</span>
        </div>
        <h3 className="mt-2 text-base font-medium text-white">多元函数条件极值</h3>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-400">
          <span className="rounded-lg border border-white/[0.08] px-2 py-1">知识卡片</span>
          <span className="rounded-lg border border-white/[0.08] px-2 py-1">错题记录</span>
        </div>
      </div>

      <div aria-hidden className="hidden place-items-center sm:grid">
        <ArrowRight className="size-4 text-teal-300/70" />
      </div>

      <PreviewNote icon={RotateCcw} label="下一次验证">
        <h3 className="text-base font-medium text-white">独立完成一道变式题</h3>
        <p className="mt-1 text-sm leading-5 text-zinc-400">不看笔记，确认能否把方法用出来。</p>
        <div className="mt-4 flex items-center gap-2 border-t border-white/[0.07] pt-3 text-xs text-zinc-500">
          <span className="size-1.5 rounded-full bg-amber-300" />
          专项复测 · 待完成
        </div>
      </PreviewNote>
    </div>
  );
}

function TodayPreview() {
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-zinc-500">今日行动序列</p>
          <CalendarCheck2 aria-hidden className="size-4 text-teal-300" />
        </div>
        <div className="mt-3 space-y-2">
          <TodayRow status="已完成" text="高等数学 · 概念与例题" tone="muted" />
          <TodayRow status="现在" text="条件极值 · 变式复测" tone="active" />
          <TodayRow status="稍后" text="英语阅读 · 长难句拆解" tone="quiet" />
        </div>
      </div>
      <PreviewNote icon={Inbox} label="今日闭环">
        <h3 className="text-base font-medium text-white">只保留下一步</h3>
        <p className="mt-1 text-sm leading-5 text-zinc-400">完成学习后，收口、复测和待处理事项回到今天。</p>
        <p className="mt-4 border-t border-white/[0.07] pt-3 text-xs leading-5 text-zinc-500">
          不是清空任务，而是明确下一件值得做的事。
        </p>
      </PreviewNote>
    </div>
  );
}

function AdjustmentPreview() {
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        <PreviewField icon={ListChecks} label="事实">
          数学投入稳定，但复测证据不足
        </PreviewField>
        <PreviewField icon={ChartNoAxesCombined} label="规则判断">
          先补证据，再扩大新内容
        </PreviewField>
        <PreviewField icon={Inbox} label="待确认草稿">
          下一周期加入条件极值专项复测
        </PreviewField>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-white/[0.07] pt-3 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-300/[0.09] px-2.5 py-1 text-amber-200">
          <FileCheck2 aria-hidden className="size-3.5" />
          需要你确认
        </span>
        <span className="text-zinc-500">确认后进入计划收件箱，不自动改写现有任务或阶段计划。</span>
      </div>
    </div>
  );
}

function PreviewNote({ children, icon: Icon, label }: { children: ReactNode; icon: LucideIcon; label: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <Icon aria-hidden className="size-3.5 text-teal-300" />
        {label}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function PreviewField({ children, icon: Icon, label }: { children: ReactNode; icon: LucideIcon; label: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <Icon aria-hidden className="size-3.5 text-teal-300" />
        {label}
      </div>
      <p className="mt-3 text-sm leading-5 text-zinc-200">{children}</p>
    </div>
  );
}

function TodayRow({ status, text, tone }: { status: string; text: string; tone: "active" | "muted" | "quiet" }) {
  const toneClass = {
    active: "border-teal-200/20 bg-teal-200/[0.07] text-teal-100",
    muted: "border-white/[0.07] bg-white/[0.025] text-zinc-400",
    quiet: "border-white/[0.05] bg-transparent text-zinc-500",
  }[tone];

  return (
    <div className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-xs ${toneClass}`}>
      <span className="w-10 shrink-0 text-[10px] font-medium">{status}</span>
      <span className="min-w-0 truncate">{text}</span>
    </div>
  );
}
