import { AlertTriangle, ArrowLeft, BookOpen, CheckCircle2, Clock3, FileText, Pause, Play, Square, Target } from "lucide-react";
import Link from "next/link";
import { Button, buttonClassName } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { withReturnTo } from "@/lib/navigation/batch7";
import { getReturnContextLabel } from "@/lib/navigation/return-context";
import type { TaskStatusDto } from "@/lib/study/types";

export type CloseoutOutcome = "achieved" | "partial" | "not-achieved";
export type UnderstandingLevel = "清晰" | "基本理解" | "模糊" | "不会";
export type TaskDisposition = "complete" | "continue" | "blocked";
export type FocusEvidenceType = "note" | "mistake" | "retest";

export interface FocusEvidenceReceipt {
  evidenceType: FocusEvidenceType;
  evidenceId: string;
  label: string;
}

export interface FocusContext {
  subjectName: string;
  taskTitle: string | null;
  syllabusNodeTitle: string | null;
  goalMinutes: number | null;
}

export function FocusHeader(props: {
  returnTo: string;
  status: "running" | "paused" | "completed" | "canceled";
  phaseLabel: string;
}) {
  return (
    <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6 lg:px-8">
      <Link href={props.returnTo} className="inline-flex h-10 items-center gap-2 text-sm text-zinc-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {getReturnContextLabel(props.returnTo, "返回来源")}
        {props.status === "running" || props.status === "paused" ? " · 计时继续" : ""}
      </Link>
      <div className="flex items-center gap-2">
        <Badge tone={props.status === "paused" ? "warning" : props.status === "completed" ? "success" : "info"}>
          {statusLabel(props.status)}
        </Badge>
        <span className="text-xs text-zinc-500">{props.phaseLabel}</span>
      </div>
    </header>
  );
}

export function FocusTimerWorkspace(props: {
  context: FocusContext;
  elapsedLabel: string;
  timerLabel: string;
  goalReached: boolean;
  status: "running" | "paused";
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
}) {
  return (
    <main className="grid min-h-[calc(100vh-3.5rem)] lg:grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.45fr)]">
      <section className="flex min-h-[32rem] flex-col items-center justify-center border-b border-white/10 px-4 py-12 text-center lg:border-b-0 lg:border-r">
        <p className="text-sm text-teal-300" aria-live="assertive" aria-atomic="true">
          {props.timerLabel}
        </p>
        <p className="mt-5 font-mono text-6xl font-semibold tabular-nums text-white sm:text-7xl lg:text-8xl">
          {props.elapsedLabel}
        </p>
        {props.context.goalMinutes ? (
          <p className={`mt-4 text-sm ${props.goalReached ? "text-amber-200" : "text-zinc-500"}`}>
            目标 {props.context.goalMinutes} 分钟{props.goalReached ? " · 已到点，不会自动结束" : ""}
          </p>
        ) : null}
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          {props.status === "running" ? (
            <Button type="button" size="lg" onClick={props.onPause}>
              <Pause className="h-4 w-4" aria-hidden="true" />暂停
            </Button>
          ) : (
            <Button type="button" size="lg" onClick={props.onResume}>
              <Play className="h-4 w-4" aria-hidden="true" />继续
            </Button>
          )}
          <Button type="button" variant="primary" size="lg" onClick={props.onEnd}>
            <Square className="h-4 w-4" aria-hidden="true" />结束并收口
          </Button>
        </div>
      </section>
      <FocusContextPanel context={props.context} />
    </main>
  );
}

export function CloseoutWorkspace(props: {
  context: FocusContext;
  elapsedLabel: string;
  outcome: CloseoutOutcome;
  understandingLevel: UnderstandingLevel;
  minimalOutput: string;
  nextAction: string;
  taskDisposition: TaskDisposition;
  validationError: string | null;
  submitting: boolean;
  onOutcomeChange: (value: CloseoutOutcome) => void;
  onUnderstandingChange: (value: UnderstandingLevel) => void;
  onMinimalOutputChange: (value: string) => void;
  onNextActionChange: (value: string) => void;
  onTaskDispositionChange: (value: TaskDisposition) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const nextActionLabel = props.taskDisposition === "blocked" ? "阻塞原因" : "下一动作";
  return (
    <main className="grid min-h-[calc(100vh-3.5rem)] lg:grid-cols-[minmax(18rem,0.65fr)_minmax(0,1.35fr)]">
      <aside className="border-b border-white/10 bg-[var(--af-surface-subtle)] px-5 py-8 lg:border-b-0 lg:border-r lg:px-8 lg:py-10">
        <p className="text-xs font-medium text-teal-300">本次学习</p>
        <h1 className="mt-2 break-words text-2xl font-semibold text-white">{props.context.taskTitle ?? "科目快捷专注"}</h1>
        <p className="mt-2 text-sm text-zinc-400">{props.context.subjectName}</p>
        <dl className="mt-8 grid gap-5 text-sm sm:grid-cols-3 lg:grid-cols-1">
          <ContextFact icon={<Clock3 />} label="实际时长" value={props.elapsedLabel} />
          <ContextFact icon={<Target />} label="目标时长" value={props.context.goalMinutes ? `${props.context.goalMinutes} 分钟` : "未设置"} />
          <ContextFact icon={<BookOpen />} label="考纲节点" value={props.context.syllabusNodeTitle ?? "未关联"} />
        </dl>
      </aside>
      <section className="px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-3xl">
          <p className="text-xs font-medium text-teal-300">学习收口</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">把这段时间转化为真实记录</h2>
          <form noValidate className="mt-8 space-y-7" onSubmit={(event) => { event.preventDefault(); props.onSubmit(); }}>
            <SegmentedField
              legend="收口结果"
              value={props.outcome}
              options={[
                { value: "achieved", label: "达成" },
                { value: "partial", label: "部分达成" },
                { value: "not-achieved", label: "未达成" },
              ]}
              onChange={(value) => props.onOutcomeChange(value as CloseoutOutcome)}
            />
            <SegmentedField
              legend="理解程度"
              value={props.understandingLevel}
              options={[
                { value: "清晰", label: "清晰" },
                { value: "基本理解", label: "基本理解" },
                { value: "模糊", label: "模糊" },
                { value: "不会", label: "不会" },
              ]}
              onChange={(value) => props.onUnderstandingChange(value as UnderstandingLevel)}
            />
            <label className="block text-sm text-zinc-300">
              最小产出
              <textarea
                required
                minLength={4}
                maxLength={1000}
                className="mt-2 min-h-28 w-full rounded-md border border-white/10 bg-[var(--af-surface-raised)] px-3 py-3 text-sm text-white placeholder:text-zinc-600"
                placeholder="写下你真正讲清、做出或纠正了什么"
                value={props.minimalOutput}
                onChange={(event) => props.onMinimalOutputChange(event.target.value)}
              />
              <span className="mt-1 block text-xs text-zinc-500">至少 4 个字符，不会自动生成占位产出。</span>
            </label>
            {props.context.taskTitle ? (
              <SegmentedField
                legend="任务去向"
                value={props.taskDisposition}
                options={[
                  { value: "complete", label: "完成任务" },
                  { value: "continue", label: "继续推进" },
                  { value: "blocked", label: "遇到阻塞" },
                ]}
                onChange={(value) => props.onTaskDispositionChange(value as TaskDisposition)}
              />
            ) : null}
            <label className="block text-sm text-zinc-300">
              {nextActionLabel}
              <input
                required
                maxLength={500}
                className="mt-2 h-11 w-full rounded-md border border-white/10 bg-[var(--af-surface-raised)] px-3 text-sm text-white placeholder:text-zinc-600"
                placeholder={props.taskDisposition === "blocked" ? "说明卡在哪里，下一次从哪里恢复" : "下一次打开时要继续做什么"}
                value={props.nextAction}
                onChange={(event) => props.onNextActionChange(event.target.value)}
              />
            </label>
            {props.validationError ? <Alert tone="danger">{props.validationError}</Alert> : null}
            <div className="flex flex-col-reverse gap-2 border-t border-white/10 pt-5 sm:flex-row sm:justify-end">
              <Button type="button" size="lg" onClick={props.onCancel}>返回计时</Button>
              <Button type="submit" variant="primary" size="lg" loading={props.submitting} loadingLabel="保存中">
                保存并继续
              </Button>
            </div>
          </form>
        </div>
      </section>
    </main>
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
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-4xl items-center px-4 py-10 sm:px-6">
      <section className="w-full border-y border-amber-400/25 py-8 sm:py-10">
        <AlertTriangle className="h-7 w-7 text-amber-300" aria-hidden="true" />
        <p className="mt-5 text-xs font-medium text-amber-300">低转化记录已保存</p>
        <h1 className="mt-2 text-2xl font-semibold text-white">这段学习还缺少可验证产出</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">{props.reason}</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Button type="button" variant="primary" size="lg" onClick={props.onSupplement}>补一个最小产出</Button>
          {props.addedToInbox ? (
            <Link href={withReturnTo("/today/inbox", props.returnTo)} className={buttonClassName({size:"lg"})}>查看计划收件箱</Link>
          ) : (
            <Button type="button" size="lg" onClick={props.onAddToInbox}>加入计划收件箱</Button>
          )}
          <Button type="button" variant="ghost" size="lg" onClick={props.onAccept}>承认低转化并结束</Button>
        </div>
      </section>
    </main>
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
    <main className="grid min-h-[calc(100vh-3.5rem)] lg:grid-cols-[minmax(18rem,0.6fr)_minmax(0,1.4fr)]">
      <aside className="border-b border-white/10 bg-[var(--af-surface-subtle)] px-5 py-8 lg:border-b-0 lg:border-r lg:px-8 lg:py-10">
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
      <section className="px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-3xl">{props.children}</div>
        <div className="mx-auto mt-8 flex max-w-3xl justify-end border-t border-white/10 pt-5">
          <Button type="button" variant="primary" size="lg" onClick={props.onComplete}>
            {props.receipts.length > 0 ? "完成证据接力" : "暂不沉淀，完成收口"}
          </Button>
        </div>
      </section>
    </main>
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
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-4xl items-center px-4 py-10 sm:px-6">
      <section className="w-full border-y border-white/10 py-9">
        <CheckCircle2 className={`h-8 w-8 ${props.lowConversion ? "text-amber-300" : "text-emerald-300"}`} aria-hidden="true" />
        <p className="mt-5 text-xs font-medium text-teal-300">本次学习已收口</p>
        <h1 className="mt-2 text-2xl font-semibold text-white">记录已经保存，可以离开专注流程</h1>
        <dl className="mt-7 grid gap-4 text-sm sm:grid-cols-3">
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
    </main>
  );
}

function FocusContextPanel({ context }: { context: FocusContext }) {
  return (
    <aside className="bg-[var(--af-surface-subtle)] px-5 py-8 sm:px-6 lg:px-8 lg:py-10">
      <p className="text-xs font-medium text-teal-300">当前上下文</p>
      <h1 className="mt-2 break-words text-2xl font-semibold text-white">{context.taskTitle ?? "科目快捷专注"}</h1>
      <p className="mt-2 text-sm text-zinc-400">{context.subjectName}</p>
      <dl className="mt-8 space-y-5 text-sm">
        <ContextFact icon={<BookOpen />} label="考纲节点" value={context.syllabusNodeTitle ?? "未关联"} />
        <ContextFact icon={<Target />} label="目标时长" value={context.goalMinutes ? `${context.goalMinutes} 分钟` : "未设置"} />
      </dl>
      <p className="mt-10 border-t border-white/10 pt-5 text-xs leading-5 text-zinc-500">离开视图不会自动暂停或结束活动。</p>
    </aside>
  );
}

function SegmentedField(props: {
  legend: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm text-zinc-300">{props.legend}</legend>
      <div className="mt-2 grid gap-2 sm:grid-flow-col sm:auto-cols-fr">
        {props.options.map((option) => (
          <label key={option.value} className={`flex h-11 cursor-pointer items-center justify-center rounded-md border px-3 text-sm ${props.value === option.value ? "border-teal-300/60 bg-teal-400/10 text-teal-100" : "border-white/10 bg-white/[0.02] text-zinc-400 hover:bg-white/[0.05]"}`}>
            <input className="sr-only" type="radio" name={props.legend} value={option.value} checked={props.value === option.value} onChange={() => props.onChange(option.value)} />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ContextFact(props: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-zinc-500 [&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">{props.icon}</span>
      <div><dt className="text-zinc-500">{props.label}</dt><dd className="mt-1 text-zinc-200">{props.value}</dd></div>
    </div>
  );
}

function EvidenceTypeButton(props: { active: boolean; disabled?: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" disabled={props.disabled} onClick={props.onClick} className={`flex min-h-11 w-full items-center gap-3 rounded-md border px-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-45 ${props.active ? "border-teal-300/50 bg-teal-400/10 text-teal-100" : "border-white/10 text-zinc-300 hover:bg-white/[0.05]"}`}>
      <span className="[&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">{props.icon}</span>{props.label}
    </button>
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

function statusLabel(status: "running" | "paused" | "completed" | "canceled") {
  if (status === "running") return "进行中";
  if (status === "paused") return "已暂停";
  if (status === "completed") return "已结束";
  return "已取消";
}

function taskStatusLabel(value: TaskStatusDto | null) {
  if (value === "done") return "已完成";
  if (value === "in_progress") return "继续推进";
  if (value === "deferred") return "已延期";
  if (value === "skipped") return "已放弃";
  if (value === "todo") return "待开始";
  return "未关联任务";
}
