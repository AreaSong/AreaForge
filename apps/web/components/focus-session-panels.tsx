"use client";

import { ArrowLeft, BookOpen, ChevronDown, Clock3, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Textarea } from "@/components/ui/field";
import { SegmentedField } from "@/components/ui/segmented-control";
import { Alert, Badge } from "@/components/ui/feedback";
import { getReturnContextLabel } from "@/lib/navigation/return-context";
import type { KnowledgePointDto } from "@/lib/contracts";
import type { StudySessionLowReasonDto } from "@/lib/contracts";
import type { SyllabusOptionNodeDto, StudyTaskDto } from "@/lib/contracts";
import {
  defaultCloseoutPreferences,
  loadCloseoutPreferences,
} from "@/lib/client/closeout-preferences";

export type CloseoutOutcome = "achieved" | "partial" | "not-achieved";
export type UnderstandingLevel = "清晰" | "基本理解" | "模糊" | "不会";
export type TaskDisposition = "complete" | "continue" | "blocked";
export type FocusEvidenceType = "note" | "mistake" | "retest";

const LOW_REASON_OPTIONS: Array<{ value: StudySessionLowReasonDto; label: string }> = [
  { value: "NOT_UNDERSTOOD", label: "没有真正理解" },
  { value: "DISTRACTED", label: "注意力分散" },
  { value: "MATERIAL_BLOCKED", label: "材料或资料卡住" },
  { value: "FATIGUE", label: "疲劳" },
  { value: "METHOD_MISMATCH", label: "方法不匹配" },
  { value: "TIME_FRAGMENTED", label: "时间被切碎" },
  { value: "OTHER", label: "其他原因" },
];

export interface FocusEvidenceReceipt {
  evidenceType: FocusEvidenceType;
  evidenceId: string;
  label: string;
}

export interface FocusContext {
  subjectId: string;
  subjectName: string;
  taskId: string | null;
  taskTitle: string | null;
  syllabusNodeId: string | null;
  syllabusNodeTitle: string | null;
  knowledgePoints: Array<{ id: string; title: string; masteryState: string }>;
  goalMinutes: number | null;
}

export interface FocusContextOptions {
  tasks: StudyTaskDto[];
  syllabusNodes: SyllabusOptionNodeDto[];
  knowledgePoints: KnowledgePointDto[];
}

export function FocusHeader(props: {
  returnTo: string;
  status: "running" | "paused" | "closing" | "completed" | "canceled";
  phaseLabel: string;
}) {
  const canLeave = props.status !== "closing";
  return (
    <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6 lg:px-8">
      {canLeave ? (
        <Link href={props.returnTo} className="inline-flex h-10 items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {getReturnContextLabel(props.returnTo, "返回来源")}
          {props.status === "running" || props.status === "paused" ? " · 计时继续" : ""}
        </Link>
      ) : (
        <span className="inline-flex h-10 items-center gap-2 text-xs sm:text-sm text-teal-300/80" role="status">
          <Clock3 className="h-4 w-4 text-teal-400" aria-hidden="true" />
          收口沉淀中 · 误触可随时在下方点击「返回计时」
        </span>
      )}
      <div className="flex items-center gap-2">
        <Badge tone={props.status === "paused" || props.status === "closing" ? "warning" : props.status === "completed" ? "success" : "info"}>
          {statusLabel(props.status)}
        </Badge>
        <span className="text-xs text-zinc-500">{props.phaseLabel}</span>
      </div>
    </header>
  );
}

export { FocusTimerWorkspace } from "./focus-timer-workspace";

export function CloseoutWorkspace(props: {
  context: FocusContext;
  elapsedLabel: string;
  outcome: CloseoutOutcome;
  understandingLevel: UnderstandingLevel | "";
  lowReasons: StudySessionLowReasonDto[];
  focusLevel: string;
  energyLevel: string;
  minimalOutput: string;
  nextAction: string;
  nextDisposition: string;
  note: string;
  taskDisposition: TaskDisposition;
  validationError: string | null;
  submitting: boolean;
  onOutcomeChange: (value: CloseoutOutcome) => void;
  onUnderstandingChange: (value: UnderstandingLevel) => void;
  onLowReasonsChange: (value: StudySessionLowReasonDto[]) => void;
  onFocusLevelChange: (value: string) => void;
  onEnergyLevelChange: (value: string) => void;
  onMinimalOutputChange: (value: string) => void;
  onNextActionChange: (value: string) => void;
  onNextDispositionChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onTaskDispositionChange: (value: TaskDisposition) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const nextActionLabel = props.taskDisposition === "blocked" ? "阻塞原因" : "下一动作";
  const [preferences, setPreferences] = useState(defaultCloseoutPreferences);
  const [optionalReviewOpen, setOptionalReviewOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const loaded = loadCloseoutPreferences();
      setPreferences(loaded);
      setOptionalReviewOpen(loaded.expandOptionalReview);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-white/10 bg-[var(--af-canvas)] animate-[fade-in_0.2s_ease-out]">
      {/* Left Column: Responsive 30% Context & Stats Sidebar */}
      <aside className="w-full lg:w-84 xl:w-96 shrink-0 bg-white/[0.015] p-6 sm:p-8 flex flex-col justify-between h-full overflow-y-auto">
        <div className="space-y-4 sm:space-y-5">
          <div className="flex items-center gap-2 text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-teal-300">
            <span className="flex size-2 rounded-full bg-teal-400" />
            本次学习 · 时间已冻结
          </div>

          <div>
            <span className="inline-flex items-center rounded-md border border-teal-500/20 bg-teal-500/10 px-2 py-0.5 text-xs font-medium text-teal-300">
              {props.context.subjectName || "未指定科目"}
            </span>
            <h1
              data-ai-current-object="true"
              data-ai-selectable
              data-ai-label={props.context.taskTitle ?? "科目快捷专注"}
              className="mt-2 break-words text-lg sm:text-xl xl:text-2xl font-bold tracking-tight text-white line-clamp-2"
            >
              {props.context.taskTitle ?? "科目快捷专注"}
            </h1>
          </div>

          <div className="rounded-2xl border border-teal-500/30 bg-teal-500/10 p-4 sm:p-5 text-center shadow-[inset_0_0_24px_rgba(45,212,191,0.08)]">
            <span className="text-xs font-medium text-teal-200/90">本次专注时长</span>
            <p className="mt-1 sm:mt-1.5 font-mono text-3xl sm:text-4xl xl:text-5xl font-bold tracking-tight text-white tabular-nums">
              {props.elapsedLabel}
            </p>
            <p className="mt-1 text-[11px] sm:text-xs text-teal-300/70">计时已冻结 · 待保存为成长事实</p>
          </div>

          <div className="space-y-2.5 rounded-2xl border border-white/5 bg-white/[0.02] p-3.5 sm:p-4 text-xs">
            <ContextFact icon={<BookOpen />} label="学习方式" value="自主沉浸学习" />
            <ContextFact icon={<Clock3 />} label="记录状态" value="待保存为成长事实" />
          </div>
        </div>

        <p className="mt-4 sm:mt-6 text-xs leading-relaxed text-zinc-500">
          保存真实产出和下一步后即可完成；更多自评按需补充。
        </p>
      </aside>

      {/* Right Column: Responsive Full-Width Rich Dashboard Form */}
      <section className="flex-1 p-6 sm:p-8 flex flex-col h-full overflow-y-auto">
        <form noValidate
          className="w-full flex-1 flex flex-col justify-between h-full"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmit();
          }}
        >
          <div className="space-y-3 sm:space-y-3.5">
            <div className="flex items-center justify-between border-b border-white/10 pb-3 sm:pb-3.5">
              <div>
                <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-teal-300">成果沉淀</p>
                <h2 className="mt-0.5 text-lg sm:text-xl font-bold tracking-tight text-white">把这段时间转化为真实记录</h2>
                <p className="mt-0.5 text-[11px] sm:text-xs text-zinc-400">选择结果，写下真实产出和下一步即可完成。</p>
              </div>
              <span className="hidden sm:inline-block rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-400 font-mono">
                3 项必填
              </span>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#0e1619]/90 p-3 sm:p-4 shadow-lg">
              <SegmentedField
                legend="收口结果"
                value={props.outcome}
                options={[
                  { value: "achieved", label: "🎯 达成" },
                  { value: "partial", label: "⚡ 部分达成" },
                  { value: "not-achieved", label: "🚧 未达成" },
                ]}
                onChange={(value) => props.onOutcomeChange(value as CloseoutOutcome)}
              />
            </div>

            {props.outcome === "not-achieved" ? (
              <fieldset className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 sm:p-4 shadow-lg">
                <legend className="text-xs font-medium text-amber-200">低效或受阻原因（至少勾选一项）</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {LOW_REASON_OPTIONS.map((reason) => (
                    <label
                      key={reason.value}
                      className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-xl border px-3 text-xs transition-colors ${
                        props.lowReasons.includes(reason.value)
                          ? "border-amber-400/60 bg-amber-400/15 text-amber-100 font-medium"
                          : "border-white/10 bg-white/[0.02] text-zinc-400 hover:bg-white/[0.05]"
                      }`}
                    >
                      <Checkbox
                        className="h-3.5 w-3.5 shrink-0 accent-amber-300"
                        checked={props.lowReasons.includes(reason.value)}
                        onChange={() => props.onLowReasonsChange(toggleReason(props.lowReasons, reason.value))}
                      />
                      <span className="truncate">{reason.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <div className="rounded-2xl border border-white/10 bg-[#0e1619]/90 p-3 sm:p-4 shadow-lg">
              <label className="block text-xs font-medium text-zinc-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs sm:text-sm font-semibold text-zinc-100">实际学习内容与产出</span>
                  <span className="text-[11px] text-zinc-500">（至少 4 个字符）</span>
                </div>
                <Textarea
                  required
                  minLength={4}
                  maxLength={1000}
                  controlHeight="sm"
                  className="mt-2 h-18 sm:h-22 min-h-18 rounded-xl border-white/10 bg-white/5 p-2.5 sm:p-3 text-xs sm:text-sm text-white placeholder:text-zinc-600 focus:border-teal-400 focus:outline-none resize-none leading-relaxed"
                  placeholder={preferences.outputPrompt}
                  value={props.minimalOutput}
                  onChange={(event) => props.onMinimalOutputChange(event.target.value)}
                />
              </label>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#0e1619]/90 p-3 sm:p-4 shadow-lg">
              <div className="grid gap-3 sm:grid-cols-2">
                {props.context.taskTitle ? (
                  <SegmentedField
                    legend="关联任务去向"
                    value={props.taskDisposition}
                    options={[
                      { value: "complete", label: "✅ 完成" },
                      { value: "continue", label: "🔄 继续" },
                      { value: "blocked", label: "🛑 阻塞" },
                    ]}
                    onChange={(value) => props.onTaskDispositionChange(value as TaskDisposition)}
                  />
                ) : null}

                <label className={`block text-xs font-medium text-zinc-200 ${!props.context.taskTitle ? "sm:col-span-1" : ""}`}>
                  <span className="text-xs sm:text-sm font-semibold text-zinc-100">{nextActionLabel}</span>
                  <Input
                    required
                    maxLength={500}
                    className="mt-1.5 h-8.5 sm:h-9 rounded-xl border-white/10 bg-white/5 px-3 text-xs sm:text-sm text-white placeholder:text-zinc-600 focus:border-teal-400 focus:outline-none"
                    placeholder={
                      props.taskDisposition === "blocked"
                        ? "说明卡在哪里，下一次从哪里恢复"
                        : preferences.nextActionPrompt
                    }
                    value={props.nextAction}
                    onChange={(event) => props.onNextActionChange(event.target.value)}
                  />
                </label>

              </div>
            </div>

            <details
              open={optionalReviewOpen}
              onToggle={(event) => setOptionalReviewOpen(event.currentTarget.open)}
              className="group rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 sm:px-4"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-zinc-300 marker:content-none">
                <span className="inline-flex items-center gap-2">
                  <SlidersHorizontal className="size-4 text-zinc-500" aria-hidden="true" />
                  可选补充
                </span>
                <ChevronDown className="size-4 text-zinc-500 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="mt-4 space-y-4 border-t border-white/10 pt-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <SegmentedField
                    legend="理解程度（可选）"
                    value={props.understandingLevel}
                    options={[
                      { value: "清晰", label: "清晰" },
                      { value: "基本理解", label: "理解" },
                      { value: "模糊", label: "模糊" },
                      { value: "不会", label: "不会" },
                    ]}
                    onChange={(value) => props.onUnderstandingChange(value as UnderstandingLevel)}
                  />
                  <div className="grid gap-4">
                    <SegmentedField
                      legend="专注度（可选）"
                      value={props.focusLevel}
                      options={ratingOptions()}
                      onChange={props.onFocusLevelChange}
                    />
                    <SegmentedField
                      legend="精力状态（可选）"
                      value={props.energyLevel}
                      options={ratingOptions()}
                      onChange={props.onEnergyLevelChange}
                    />
                  </div>
                </div>
                <label className="block text-xs font-medium text-zinc-300">
                  收口后处置（可选）
                  <Input
                    maxLength={500}
                    className="mt-1.5"
                    placeholder="例如：安排复测"
                    value={props.nextDisposition}
                    onChange={(event) => props.onNextDispositionChange(event.target.value)}
                  />
                </label>
                <label className="block text-xs font-medium text-zinc-300">
                  补充备注（可选）
                  <Textarea
                    maxLength={2000}
                    controlHeight="sm"
                    className="mt-1.5 min-h-20 resize-y"
                    placeholder="只记录本次需要保留的额外信息"
                    value={props.note}
                    onChange={(event) => props.onNoteChange(event.target.value)}
                  />
                </label>
              </div>
            </details>

            {props.validationError ? <Alert tone="danger">{props.validationError}</Alert> : null}
          </div>

          <div className="flex items-center justify-between gap-3 sm:gap-4 border-t border-white/10 pt-3.5 mt-auto">
            <Button
              type="button"
              variant="secondary"
              onClick={props.onCancel}
              leftIcon={<ArrowLeft className="size-4" />}
            >
              <span>返回继续计时</span>
            </Button>

            <Button
              type="submit"
              variant="primary"
              disabled={props.submitting}
              loading={props.submitting}
              loadingLabel="正在保存..."
            >
              保存本次学习
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

export { LowConversionWorkspace } from "./focus-session-low-conversion";

export {
  EvidenceWorkspace,
  CompleteWorkspace,
} from "./focus-session-evidence";

function ratingOptions(): Array<{ value: string; label: string }> {
  return [1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: String(value) }));
}

function toggleReason(current: StudySessionLowReasonDto[], value: StudySessionLowReasonDto): StudySessionLowReasonDto[] {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function ContextFact(props: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2">
      <div className="flex items-center gap-2 text-zinc-400">
        <span className="[&>svg]:size-3.5 text-teal-300" aria-hidden="true">
          {props.icon}
        </span>
        <dt className="text-xs text-zinc-400">{props.label}</dt>
      </div>
      <dd className="text-xs font-medium text-zinc-200">{props.value}</dd>
    </div>
  );
}

function statusLabel(status: "running" | "paused" | "closing" | "completed" | "canceled") {
  if (status === "running") return "进行中";
  if (status === "paused") return "已暂停";
  if (status === "closing") return "待收口";
  if (status === "completed") return "已结束";
  return "已取消";
}
