import { AlertTriangle, ArrowLeft, BookOpen, CheckCircle2, Clock3, FileText, Target } from "lucide-react";
import Link from "next/link";
import { Button, buttonClassName } from "@/components/ui/button";
import { Checkbox, Input, Radio, Textarea } from "@/components/ui/field";
import { Alert, Badge } from "@/components/ui/feedback";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import { getReturnContextLabel } from "@/lib/navigation/return-context";
import type { KnowledgePointDto } from "@/lib/contracts";
import type { StudySessionLowReasonDto, TaskStatusDto } from "@/lib/contracts";
import type { SyllabusOptionNodeDto, StudyTaskDto } from "@/lib/contracts";
import { formatTaskStatus } from "@/lib/formatters";

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
  understandingLevel: UnderstandingLevel;
  lowReasons: StudySessionLowReasonDto[];
  focusLevel: string;
  energyLevel: string;
  minimalOutput: string;
  nextAction: string;
  nextDisposition: string;
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
  onTaskDispositionChange: (value: TaskDisposition) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const nextActionLabel = props.taskDisposition === "blocked" ? "阻塞原因" : "下一动作";
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10 animate-[fade-in_0.25s_ease-out]">
      <div className="grid gap-8 lg:grid-cols-12">
        {/* Left Side: Session Battle Report Recap Card */}
        <aside className="flex flex-col gap-5 lg:col-span-4">
          <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02] p-6 shadow-2xl backdrop-blur-md">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-teal-300">
              <span className="flex size-2 rounded-full bg-teal-400 animate-pulse" />
              专注战报 · 已记录
            </div>

            <div className="mt-4">
              <span className="inline-flex items-center rounded-md border border-teal-500/20 bg-teal-500/10 px-2.5 py-1 text-xs font-medium text-teal-300">
                {props.context.subjectName || "未指定科目"}
              </span>
              <h1
                data-ai-current-object="true"
                data-ai-selectable
                data-ai-label={props.context.taskTitle ?? "科目快捷专注"}
                className="mt-2.5 break-words text-xl sm:text-2xl font-bold tracking-tight text-white"
              >
                {props.context.taskTitle ?? "科目快捷专注"}
              </h1>
            </div>

            {/* Big Highlight Elapsed Time Card */}
            <div className="mt-5 rounded-xl border border-teal-500/30 bg-teal-500/10 p-4 text-center shadow-[inset_0_0_24px_rgba(45,212,191,0.08)]">
              <p className="text-xs font-medium text-teal-200/80">本次有效专注投入</p>
              <p className="mt-1 font-mono text-4xl sm:text-5xl font-bold tracking-tight text-white tabular-nums">
                {props.elapsedLabel}
              </p>
              <p className="mt-1 text-[11px] text-teal-300/70">时长已冻结，待完成收口沉淀</p>
            </div>

            <dl className="mt-5 space-y-3 border-t border-white/10 pt-4 text-xs">
              <ContextFact icon={<BookOpen />} label="学习方式" value="自主沉浸学习" />
              <ContextFact icon={<Clock3 />} label="记录状态" value="待保存为永久成长事实" />
            </dl>

            <div className="mt-5 rounded-xl border border-white/5 bg-white/[0.03] p-3.5 text-xs leading-relaxed text-zinc-400">
              <p className="font-medium text-zinc-300">💡 为什么需要收口？</p>
              <p className="mt-1 text-[11px] text-zinc-400">
                花 1 分钟复盘产出与理解盲点，能将本次零散的专注时间沉淀为真实的认知掌控力，避免盲目刷时长的假装努力。
              </p>
            </div>

            <button
              type="button"
              onClick={props.onCancel}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-medium text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="size-3.5" />
              <span>点错了？返回继续计时</span>
            </button>
          </div>
        </aside>

        {/* Right Side: Structured Closeout Form */}
        <section className="lg:col-span-8">
          <div className="rounded-2xl border border-white/10 bg-[#0d1317]/90 p-6 sm:p-8 shadow-2xl backdrop-blur-md">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-teal-300">成果沉淀</p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight text-white">把这段时间转化为真实记录</h2>
              <p className="mt-1 text-xs sm:text-sm text-zinc-400">
                记录真实的理解深度与产出断点，为下一次学习快速切入提供锚点。
              </p>
            </div>

            <form
              noValidate
              className="mt-7 space-y-6"
              onSubmit={(event) => {
                event.preventDefault();
                props.onSubmit();
              }}
            >
              {/* Outcome & Understanding Level */}
              <div className="space-y-5 rounded-xl border border-white/5 bg-white/[0.02] p-4 sm:p-5">
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

                <SegmentedField
                  legend="理解程度"
                  value={props.understandingLevel}
                  options={[
                    { value: "清晰", label: "清晰透彻" },
                    { value: "基本理解", label: "基本理解" },
                    { value: "模糊", label: "略有模糊" },
                    { value: "不会", label: "尚未掌握" },
                  ]}
                  onChange={(value) => props.onUnderstandingChange(value as UnderstandingLevel)}
                />
              </div>

              {/* Focus & Energy Rating */}
              <div className="space-y-5 rounded-xl border border-white/5 bg-white/[0.02] p-4 sm:p-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <SegmentedField
                    legend="专注度（1-5 分）"
                    value={props.focusLevel}
                    options={ratingOptions()}
                    onChange={props.onFocusLevelChange}
                  />
                  <SegmentedField
                    legend="精力状态（1-5 分）"
                    value={props.energyLevel}
                    options={ratingOptions()}
                    onChange={props.onEnergyLevelChange}
                  />
                </div>
              </div>

              {/* Low reason checkbox if not achieved */}
              {props.outcome === "not-achieved" ? (
                <fieldset className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 sm:p-5">
                  <legend className="text-sm font-medium text-amber-200">低效或受阻原因（至少勾选一项）</legend>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {LOW_REASON_OPTIONS.map((reason) => (
                      <label
                        key={reason.value}
                        className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3 text-xs sm:text-sm transition-colors ${
                          props.lowReasons.includes(reason.value)
                            ? "border-amber-400/60 bg-amber-400/15 text-amber-100 font-medium"
                            : "border-white/10 bg-white/[0.02] text-zinc-400 hover:bg-white/[0.05]"
                        }`}
                      >
                        <Checkbox
                          className="h-4 w-4 shrink-0 accent-amber-300"
                          checked={props.lowReasons.includes(reason.value)}
                          onChange={() => props.onLowReasonsChange(toggleReason(props.lowReasons, reason.value))}
                        />
                        <span>{reason.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}

              {/* Output & Takeaways */}
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4 sm:p-5">
                <label className="block text-sm font-medium text-zinc-200">
                  实际学习内容与产出
                  <Textarea
                    required
                    minLength={4}
                    maxLength={1000}
                    controlHeight="lg"
                    className="mt-2 min-h-24 rounded-xl border-white/10 bg-white/5 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-teal-400 focus:outline-none"
                    placeholder="例如：一元函数微分学理解了极值定理，做完了例题 3-5，整理了 1 个错题"
                    value={props.minimalOutput}
                    onChange={(event) => props.onMinimalOutputChange(event.target.value)}
                  />
                  <span className="mt-1.5 block text-xs text-zinc-500">
                    记录具体学到的知识点、页码、题号或思维断点（至少 4 个字符）。
                  </span>
                </label>
              </div>

              {/* Next Actions & Task Disposition */}
              <div className="space-y-4 rounded-xl border border-white/5 bg-white/[0.02] p-4 sm:p-5">
                {props.context.taskTitle ? (
                  <SegmentedField
                    legend="关联任务去向"
                    value={props.taskDisposition}
                    options={[
                      { value: "complete", label: "✅ 完成该任务" },
                      { value: "continue", label: "🔄 继续推进" },
                      { value: "blocked", label: "🛑 遇到阻塞" },
                    ]}
                    onChange={(value) => props.onTaskDispositionChange(value as TaskDisposition)}
                  />
                ) : null}

                <label className="block text-sm font-medium text-zinc-200">
                  {nextActionLabel}
                  <Input
                    required
                    maxLength={500}
                    className="mt-2 h-11 rounded-xl border-white/10 bg-white/5 text-sm text-white placeholder:text-zinc-600 focus:border-teal-400 focus:outline-none"
                    placeholder={
                      props.taskDisposition === "blocked"
                        ? "说明卡在哪里，下一次从哪里恢复"
                        : "下一次打开时要继续做什么"
                    }
                    value={props.nextAction}
                    onChange={(event) => props.onNextActionChange(event.target.value)}
                  />
                </label>

                <label className="block text-sm font-medium text-zinc-200">
                  收口后处置与备忘（可选）
                  <Input
                    maxLength={500}
                    className="mt-2 h-11 rounded-xl border-white/10 bg-white/5 text-sm text-white placeholder:text-zinc-600 focus:border-teal-400 focus:outline-none"
                    placeholder="例如：补做两道题、安排复测、明天继续"
                    value={props.nextDisposition}
                    onChange={(event) => props.onNextDispositionChange(event.target.value)}
                  />
                </label>
              </div>

              {props.validationError ? <Alert tone="danger">{props.validationError}</Alert> : null}

              {/* Bottom Actions */}
              <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 border-t border-white/10 pt-5">
                <button
                  type="button"
                  onClick={props.onCancel}
                  className="inline-flex h-11 w-full sm:w-auto items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-medium text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
                >
                  <ArrowLeft className="size-4" />
                  <span>返回继续计时</span>
                </button>

                <button
                  type="submit"
                  disabled={props.submitting}
                  className="inline-flex h-11 w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-teal-400 px-8 text-sm font-semibold text-[#061012] shadow-[0_0_24px_rgba(45,212,191,0.35)] transition-all hover:bg-teal-300 hover:shadow-[0_0_32px_rgba(45,212,191,0.5)] active:scale-[0.98] disabled:opacity-50"
                >
                  {props.submitting ? "正在保存..." : "保存并沉淀本次学习"}
                </button>
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}

export function LowConversionWorkspace(props: {
  reason: string;
  addedToInbox: boolean;
  returnTo: string;
  onSupplement: () => void;
  onAddToInbox: () => void;
  onAccept: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl items-center px-4 py-10 sm:px-6">
      <section className="w-full border-y border-amber-400/25 py-8 sm:py-10">
        <AlertTriangle className="h-7 w-7 text-amber-300" aria-hidden="true" />
        <p className="mt-5 text-xs font-medium text-amber-300">低转化记录已保存</p>
        <h1 className="mt-2 text-2xl font-semibold text-white">这段学习还缺少可验证产出</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">{props.reason}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Button type="button" variant="primary" size="lg" onClick={props.onSupplement}>补一个最小产出</Button>
          {props.addedToInbox ? (
            <Link href={withReturnTo("/roadmap/allocation/drafts", props.returnTo)} className={buttonClassName({size:"lg"})}>查看投入草稿</Link>
          ) : (
            <Button type="button" size="lg" onClick={props.onAddToInbox}>加入投入草稿</Button>
          )}
          <Button type="button" variant="ghost" size="lg" onClick={props.onAccept}>承认低转化并结束</Button>
        </div>
      </section>
    </div>
  );
}

export function EvidenceWorkspace(props: {
  activeType: FocusEvidenceType;
  canRetest: boolean;
  receipts: FocusEvidenceReceipt[];
  onTypeChange: (value: FocusEvidenceType) => void;
  onComplete: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="af-focus-workspace-grid grid min-h-full min-w-0">
      <aside className="af-workspace-aside bg-[var(--af-surface-subtle)] px-5 py-8">
        <p className="text-xs font-medium text-teal-300">证据接力</p>
        <h1 className="mt-2 text-2xl font-semibold text-white">为本次学习留下一个可复用证据</h1>
        <div className="mt-7 grid gap-2">
          <EvidenceTypeButton active={props.activeType === "note"} icon={<FileText />} label="知识卡片" onClick={() => props.onTypeChange("note")} />
          <EvidenceTypeButton active={props.activeType === "mistake"} icon={<AlertTriangle />} label="错题" onClick={() => props.onTypeChange("mistake")} />
          <EvidenceTypeButton active={props.activeType === "retest"} disabled={!props.canRetest} icon={<Target />} label={props.canRetest ? "复测" : "复测 · 未关联考纲"} onClick={() => props.onTypeChange("retest")} />
        </div>
        <div className="mt-8 border-t border-white/10 pt-5">
          <p className="text-xs text-zinc-500">本次已保存 {props.receipts.length} 条证据</p>
          {props.receipts.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {props.receipts.map((receipt) => (
                <li key={`${receipt.evidenceType}:${receipt.evidenceId}`} className="flex items-start gap-2 text-sm text-zinc-300">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                  <span className="break-words">{evidenceTypeLabel(receipt.evidenceType)} · {receipt.label}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </aside>
      <section className="af-workspace-main px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-3xl">{props.children}</div>
        <div className="mx-auto mt-8 flex max-w-3xl justify-end border-t border-white/10 pt-5">
          <Button type="button" variant="primary" size="lg" onClick={props.onComplete}>
            {props.receipts.length > 0 ? "完成证据接力" : "暂不沉淀，完成收口"}
          </Button>
        </div>
      </section>
    </div>
  );
}

export function CompleteWorkspace(props: {
  elapsedLabel: string;
  lowConversion: boolean;
  taskStatus: TaskStatusDto | null;
  returnTo: string;
  receipts: FocusEvidenceReceipt[];
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl items-center px-4 py-10 sm:px-6">
      <section className="w-full border-y border-white/10 py-9">
        <CheckCircle2 className={`h-8 w-8 ${props.lowConversion ? "text-amber-300" : "text-emerald-300"}`} aria-hidden="true" />
        <p className="mt-5 text-xs font-medium text-teal-300">本次学习已收口</p>
        <h1 className="mt-2 text-2xl font-semibold text-white">记录已经保存，可以离开专注流程</h1>
        <dl className="af-metric-grid-three mt-7 grid gap-4 text-sm">
          <SummaryFact label="实际时长" value={props.elapsedLabel} />
          <SummaryFact label="转化结果" value={props.lowConversion ? "低转化" : "有效学习"} />
          <SummaryFact label="任务状态" value={taskStatusLabel(props.taskStatus)} />
        </dl>
        {props.receipts.length > 0 ? (
          <div className="mt-7 border-t border-white/10 pt-5">
            <p className="text-xs text-zinc-500">本次学习证据</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {props.receipts.map((receipt) => (
                <li key={`${receipt.evidenceType}:${receipt.evidenceId}`}><Badge tone="success">{evidenceTypeLabel(receipt.evidenceType)} · {receipt.label}</Badge></li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/today" className={buttonClassName({ variant: "primary", size: "lg" })}>
            回到今日，查看下一行动
          </Link>
          {props.returnTo !== "/today" ? (
            <Link href={props.returnTo} className={buttonClassName({ variant: "secondary", size: "lg" })}>
              {getReturnContextLabel(props.returnTo, "返回原位置")}
            </Link>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function ratingOptions(): Array<{ value: string; label: string }> {
  return [1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: String(value) }));
}

function toggleReason(current: StudySessionLowReasonDto[], value: StudySessionLowReasonDto): StudySessionLowReasonDto[] {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function SegmentedField(props: {
  legend: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-xs sm:text-sm font-medium text-zinc-300">{props.legend}</legend>
      <div className="af-segmented-options mt-2.5 grid grid-cols-2 sm:grid-flow-col sm:auto-cols-fr gap-2">
        {props.options.map((option) => {
          const active = props.value === option.value;
          return (
            <label
              key={option.value}
              className={`relative flex h-10 cursor-pointer items-center justify-center rounded-xl border px-3 text-xs sm:text-sm font-medium transition-all select-none ${
                active
                  ? "border-teal-400/80 bg-teal-500/20 text-teal-100 shadow-[0_0_16px_rgba(45,212,191,0.2)]"
                  : "border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:bg-white/[0.07] hover:text-zinc-200"
              }`}
            >
              <Radio
                className="sr-only"
                name={props.legend}
                value={option.value}
                checked={active}
                onChange={() => props.onChange(option.value)}
              />
              <span className="truncate">{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
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

function EvidenceTypeButton(props: { active: boolean; disabled?: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="lg"
      aria-pressed={props.active}
      disabled={props.disabled}
      onClick={props.onClick}
      className={`w-full !justify-start !gap-3 !px-3 !text-left !font-normal ${props.active ? "!border-teal-300/50 !bg-teal-400/10 !text-teal-100" : "!border-white/10 !bg-transparent !text-zinc-300 hover:!bg-white/[0.05]"} disabled:!cursor-not-allowed disabled:!opacity-45`}
    >
      <span className="[&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">{props.icon}</span>{props.label}
    </Button>
  );
}

function evidenceTypeLabel(value: FocusEvidenceType) {
  if (value === "note") return "知识卡片";
  if (value === "mistake") return "错题";
  return "复测";
}

function SummaryFact(props: { label: string; value: string }) {
  return <div><dt className="text-zinc-500">{props.label}</dt><dd className="mt-1 font-medium text-zinc-100">{props.value}</dd></div>;
}

function statusLabel(status: "running" | "paused" | "closing" | "completed" | "canceled") {
  if (status === "running") return "进行中";
  if (status === "paused") return "已暂停";
  if (status === "closing") return "待收口";
  if (status === "completed") return "已结束";
  return "已取消";
}

function taskStatusLabel(value: TaskStatusDto | null) {
  if (value === "in_progress") return "继续推进";
  return value ? formatTaskStatus(value) : "未关联任务";
}
