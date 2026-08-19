import { AlertTriangle, ArrowLeft, BookOpen, CheckCircle2, Clock3, FileText, Pause, Play, Square, Target } from "lucide-react";
import Link from "next/link";
import { Button, buttonClassName } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import { getReturnContextLabel } from "@/lib/navigation/return-context";
import type { KnowledgePointDto } from "@/lib/study/knowledge-point-service";
import type { StudySessionLowReasonDto, TaskStatusDto } from "@/lib/study/types";
import type { SyllabusOptionNodeDto, StudyTaskDto } from "@/lib/study/types";

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
        <Link href={props.returnTo} className="inline-flex h-10 items-center gap-2 text-sm text-zinc-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {getReturnContextLabel(props.returnTo, "返回来源")}
          {props.status === "running" || props.status === "paused" ? " · 计时继续" : ""}
        </Link>
      ) : (
        <span className="inline-flex h-10 items-center gap-2 text-sm text-amber-200" role="status">
          <ArrowLeft className="h-4 w-4 opacity-50" aria-hidden="true" />
          收口未完成，暂不能离开
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
    <div className="grid min-h-full min-w-0 min-[1200px]:grid-cols-[minmax(18rem,0.65fr)_minmax(0,1.35fr)]">
      <aside className="border-b border-white/10 bg-[var(--af-surface-subtle)] px-5 py-8 min-[1200px]:border-r min-[1200px]:border-b-0 min-[1200px]:px-8 min-[1200px]:py-10">
        <p className="text-xs font-medium text-teal-300">本次学习</p>
        <h1 data-ai-current-object="true" data-ai-selectable data-ai-label={props.context.taskTitle ?? "科目快捷专注"} className="mt-2 break-words text-2xl font-semibold text-white">{props.context.taskTitle ?? "科目快捷专注"}</h1>
        <p className="mt-2 text-sm text-zinc-400">{props.context.subjectName}</p>
        <dl className="mt-8 grid gap-5 text-sm sm:grid-cols-3 min-[1200px]:grid-cols-1">
          <ContextFact icon={<Clock3 />} label="实际时长" value={props.elapsedLabel} />
          <ContextFact icon={<BookOpen />} label="学习方式" value="自由学习" />
        </dl>
      </aside>
      <section className="px-4 py-8 sm:px-6 min-[1200px]:px-10 min-[1200px]:py-10">
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
            <div className="grid gap-5 sm:grid-cols-2">
              <SegmentedField
                legend="专注度（1-5）"
                value={props.focusLevel}
                options={ratingOptions()}
                onChange={props.onFocusLevelChange}
              />
              <SegmentedField
                legend="精力（1-5）"
                value={props.energyLevel}
                options={ratingOptions()}
                onChange={props.onEnergyLevelChange}
              />
            </div>
            {props.outcome === "not-achieved" ? (
              <fieldset>
                <legend className="text-sm text-zinc-300">低效原因（至少选择一项）</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {LOW_REASON_OPTIONS.map((reason) => (
                    <label key={reason.value} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${props.lowReasons.includes(reason.value) ? "border-amber-300/60 bg-amber-400/10 text-amber-100" : "border-white/10 bg-white/[0.02] text-zinc-400 hover:bg-white/[0.05]"}`}>
                      <input
                        type="checkbox"
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
            <label className="block text-sm text-zinc-300">
              实际学习内容与产出
              <textarea
                required
                minLength={4}
                maxLength={1000}
                className="mt-2 min-h-28 w-full rounded-md border border-white/10 bg-[var(--af-surface-raised)] px-3 py-3 text-sm text-white placeholder:text-zinc-600"
                placeholder="例如：一元函数理解了定义，学到函数极限例题 3"
                value={props.minimalOutput}
                onChange={(event) => props.onMinimalOutputChange(event.target.value)}
              />
              <span className="mt-1 block text-xs text-zinc-500">可以填写多个内容或学习断点，至少 4 个字符。</span>
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
            <label className="block text-sm text-zinc-300">
              收口后的处置
              <input
                maxLength={500}
                className="mt-2 h-11 w-full rounded-md border border-white/10 bg-[var(--af-surface-raised)] px-3 text-sm text-white placeholder:text-zinc-600"
                placeholder="例如：补做两道题、安排复测、明天继续"
                value={props.nextDisposition}
                onChange={(event) => props.onNextDispositionChange(event.target.value)}
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
    <div className="grid min-h-full min-w-0 min-[1200px]:grid-cols-[minmax(18rem,0.6fr)_minmax(0,1.4fr)]">
      <aside className="border-b border-white/10 bg-[var(--af-surface-subtle)] px-5 py-8 min-[1200px]:border-r min-[1200px]:border-b-0 min-[1200px]:px-8 min-[1200px]:py-10">
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
      <section className="px-4 py-8 sm:px-6 min-[1200px]:px-10 min-[1200px]:py-10">
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

function statusLabel(status: "running" | "paused" | "closing" | "completed" | "canceled") {
  if (status === "running") return "进行中";
  if (status === "paused") return "已暂停";
  if (status === "closing") return "待收口";
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
