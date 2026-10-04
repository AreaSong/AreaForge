import { ArrowLeft, ArrowRight, BookOpen, History } from "lucide-react";
import Link from "next/link";
import { DetailHeading } from "@/components/detail-heading";
import { KnowledgeNextAction } from "@/components/knowledge-next-action";
import { SafeMarkdownView } from "@/components/safe-markdown-view";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Input, Radio, Select, Textarea } from "@/components/ui/field";
import {
  masteryChangeLabel,
  reviewResultLabel,
  safeConflictWorkbench,
  type ConfirmResponse,
  type ConflictBody,
  type DraftAccess,
} from "@/components/quick-review-client-support";
import type { QuickReviewDraft, QuickReviewResult } from "@/lib/client/quick-review-draft";
import type { ReviewScheduleDto, ReviewTargetDto } from "@/lib/contracts";
import { formatDate, formatShortDuration } from "@/lib/formatters";
import { withReturnTo } from "@/lib/navigation/app-navigation";
import { getCompletionReturnLabel, getReturnContextLabel } from "@/lib/navigation/return-context";

export function QuickReviewPaused(props: { returnTo: string }) {
  return (
    <section className="mx-auto flex min-h-full max-w-xl flex-col justify-center gap-3 px-4 py-8">
      <DetailHeading className="text-2xl font-semibold text-white">排期已暂停</DetailHeading>
      <p className="text-sm text-zinc-400">暂停的复习排期不能开始快速复习。</p>
      <Link href={props.returnTo} className="text-teal-300 hover:underline">{getReturnContextLabel(props.returnTo, "返回复习队列")}</Link>
    </section>
  );
}

export function QuickReviewUnavailable(props: { target: ReviewTargetDto; returnTo: string }) {
  return (
    <section className="mx-auto flex min-h-full max-w-xl flex-col justify-center gap-4 px-4 py-8">
      <DetailHeading className="text-2xl font-semibold text-white">错题需要先补全</DetailHeading>
      <p className="text-sm leading-6 text-zinc-400">这条旧错题缺少明确错因或正确思路，当前不能开始或确认快速复习。</p>
      <div className="flex flex-wrap gap-3">
        <Link href={withReturnTo(props.target.canonicalHref, props.returnTo)} className="inline-flex h-11 items-center rounded-md bg-teal-500 px-4 text-sm font-medium text-black">打开错题详情</Link>
        <Link href={props.returnTo} className="inline-flex h-11 items-center text-sm text-teal-300 hover:underline">{getReturnContextLabel(props.returnTo, "返回原位置")}</Link>
      </div>
    </section>
  );
}

export function QuickReviewDone(props: {
  done: ConfirmResponse;
  target: ReviewTargetDto;
  schedule: ReviewScheduleDto;
  returnTo: string;
}) {
  const actionLabel = props.done.nextScheduleId ? "继续下一项" : getCompletionReturnLabel(props.returnTo);
  const actionHref = props.done.nextScheduleId
    ? withReturnTo(`/knowledge/reviews/${props.done.nextScheduleId}/run`, props.returnTo)
    : props.returnTo;
  return (
    <section className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-5 px-4 py-8">
      <DetailHeading className="text-2xl font-semibold text-white">本次复习已确认</DetailHeading>
      <KnowledgeNextAction
        title={props.done.nextScheduleId ? "继续下一项复习" : actionLabel}
        description={props.done.nextScheduleId
          ? "当前结果已经写入复习历史，继续下一项会沿用本次来源。"
          : "当前结果已经写入复习历史，回到来源后可以继续处理下一行动。"}
        status={<span className="rounded-xl border border-teal-300/30 bg-teal-300/10 px-3 py-2 text-sm text-teal-100">结果已保存</span>}
        action={<ButtonLink href={actionHref} variant="primary" size="md">{props.done.nextScheduleId ? <ArrowRight size={16} aria-hidden /> : <ArrowLeft size={16} aria-hidden />}{actionLabel}</ButtonLink>}
      />
      <div className="grid grid-cols-2 gap-3">
        <Card variant="subtle" className="p-3.5">
          <p className="text-xs text-zinc-400">本次结果</p>
          <p className="mt-1 font-semibold text-white">{reviewResultLabel(props.done.event.result)}</p>
        </Card>
        <Card variant="subtle" className="p-3.5">
          <p className="text-xs text-zinc-400">有效时长</p>
          <p className="mt-1 font-semibold text-white">{formatShortDuration(props.done.event.durationSeconds)}</p>
        </Card>
        <Card variant="subtle" className="p-3.5">
          <p className="text-xs text-zinc-400">下次复习</p>
          <p className="mt-1 font-semibold text-white">{formatDate(props.done.event.nextDueDate)}</p>
        </Card>
        <Card variant="subtle" className="p-3.5">
          <p className="text-xs text-zinc-400">掌握变化</p>
          <p className="mt-1 font-semibold text-white">{masteryChangeLabel(props.schedule.consecutivePassCount, props.done.schedule.consecutivePassCount)}</p>
        </Card>
      </div>
      <Card variant="subtle" className="space-y-2 p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-teal-300">本次复习对象</p>
        <h2 className="text-lg font-semibold text-white">{props.target.title}</h2>
        <p className="text-sm text-zinc-400">{props.target.subtitle}</p>
      </Card>
      <p className="text-sm text-zinc-400">结果已经写入复习历史{props.done.reused ? "，本次为幂等重试复用" : ""}。</p>
      <div className="flex flex-wrap gap-3">
        <Link href={withReturnTo(props.target.canonicalHref, props.returnTo)} className="inline-flex h-10 items-center gap-2 px-2 text-sm font-medium text-teal-300 hover:underline"><BookOpen size={16} aria-hidden />查看对象详情</Link>
        <Link href={withReturnTo(`/knowledge/reviews/${props.done.schedule.id}`, props.returnTo)} className="inline-flex h-10 items-center gap-2 px-2 text-sm text-zinc-300 hover:text-white"><History size={16} aria-hidden />查看复习历史</Link>
      </div>
    </section>
  );
}

export function QuickReviewTargetCard(props: {
  target: ReviewTargetDto;
  schedule: ReviewScheduleDto;
  draft: QuickReviewDraft;
  returnTo: string;
}) {
  return (
    <Card variant="master" className="space-y-4 p-5 sm:p-6" aria-labelledby="quick-review-target">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-300">复习对象</p>
          <h2 id="quick-review-target" className="mt-1 text-xl font-semibold text-white">{props.target.title}</h2>
        </div>
        <Link className="text-sm font-medium text-teal-300 hover:underline" href={withReturnTo(props.target.canonicalHref, props.returnTo)}>打开详情</Link>
      </div>
      <SafeMarkdownView nodes={props.target.body} />
      {props.schedule.targetType === "MISTAKE" && props.draft.revealed && props.target.revealBody.length ? (
        <div className="border-t border-white/10 pt-4">
          <p className="text-sm font-semibold text-amber-200">{props.target.revealTitle}</p>
          <div className="mt-2"><SafeMarkdownView nodes={props.target.revealBody} /></div>
        </div>
      ) : null}
    </Card>
  );
}

export function QuickReviewForm(props: {
  targetType: ReviewScheduleDto["targetType"];
  draft: QuickReviewDraft;
  activityBlocked: boolean;
  durationSeconds: number;
  submitting: boolean;
  mistakeAnswered: boolean;
  onUpdate: (patch: Partial<QuickReviewDraft>) => void;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  if (props.targetType === "MISTAKE" && !props.draft.revealed) {
    return (
      <Card variant="master" className="space-y-4 p-5 sm:p-6">
        <p className="text-sm text-zinc-300">先完成作答，再揭示错题内容。</p>
        <fieldset disabled={props.activityBlocked} className="space-y-2 disabled:opacity-60">
          <legend className="text-sm text-zinc-400">作答方式</legend>
          <label className="flex items-center gap-2 text-sm text-zinc-200"><Radio name="quick-review-answer-mode" checked={props.draft.answerMode === "TEXT"} onChange={() => props.onUpdate({ answerMode: "TEXT" })} />文字作答</label>
          <label className="flex items-center gap-2 text-sm text-zinc-200"><Radio name="quick-review-answer-mode" checked={props.draft.answerMode === "PAPER_OR_ORAL"} onChange={() => props.onUpdate({ answerMode: "PAPER_OR_ORAL" })} />纸上或口头作答</label>
        </fieldset>
        {props.draft.answerMode === "TEXT" ? (
          <label className="block text-sm text-zinc-300">你的答案<Textarea disabled={props.activityBlocked} className="mt-1 min-h-24 rounded-xl px-3 disabled:opacity-60" value={props.draft.answerText} onChange={(event) => props.onUpdate({ answerText: event.target.value })} /></label>
        ) : (
          <label className="flex items-center gap-2 text-sm text-zinc-200"><Checkbox disabled={props.activityBlocked} checked={props.draft.paperOrOralCompleted} onChange={(event) => props.onUpdate({ paperOrOralCompleted: event.target.checked })} />我已完成纸上或口头作答</label>
        )}
        <Button type="button" variant="primary" disabled={props.activityBlocked || !props.mistakeAnswered} className="h-11 px-4" onClick={() => props.onUpdate({ revealed: true })}>完成作答，继续</Button>
      </Card>
    );
  }

  return (
    <Card variant="master" className="space-y-4 p-5 sm:p-6">
      {props.targetType === "MISTAKE" ? <p className="text-xs font-medium text-teal-300">已完成{props.draft.answerMode === "TEXT" ? "文字" : "纸上或口头"}作答</p> : null}
      <label className="block text-sm text-zinc-300">结果<Select disabled={props.activityBlocked} className="mt-1 rounded-xl px-3 disabled:opacity-60" value={props.draft.result} onChange={(event) => props.onUpdate({ result: event.target.value as QuickReviewResult })}><option value="PASSED">通过</option><option value="PARTIAL">部分</option><option value="FAILED">失败</option></Select></label>
      <label className="block text-sm text-zinc-300">下次日期（可选）<Input type="date" disabled={props.activityBlocked} className="mt-1 rounded-xl px-3 disabled:opacity-60" value={props.draft.nextDueDate} onChange={(event) => props.onUpdate({ nextDueDate: event.target.value })} /></label>
      <label className="block text-sm text-zinc-300">备注<Textarea disabled={props.activityBlocked} className="mt-1 min-h-20 rounded-xl px-3 disabled:opacity-60" value={props.draft.note} onChange={(event) => props.onUpdate({ note: event.target.value })} /></label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="primary" disabled={props.activityBlocked || props.submitting || props.durationSeconds < 1} className="h-11 px-4" onClick={props.onConfirm}>{props.submitting ? "确认中..." : "确认本次复习"}</Button>
        <Button type="button" variant="secondary" disabled={props.activityBlocked} className="h-11 px-4" onClick={props.onDiscard}>丢弃草稿</Button>
      </div>
      {props.durationSeconds < 1 ? <p role="status" className="text-xs text-zinc-400">计时达到 1 秒后才可确认，服务端不会接受 0 秒复习。</p> : null}
    </Card>
  );
}

export function QuickReviewFailure(props: {
  error: ConflictBody | null;
  access: DraftAccess;
  remoteDraft: QuickReviewDraft | null;
  conflict: ConflictBody | null;
  conflictOpen: boolean;
  onOpenConflict: () => void;
}) {
  return (
    <>
      {props.error ? (
        <div role="alert" className="rounded-md border border-red-400/20 bg-red-950/20 p-3 text-sm text-red-200">
          <p>{props.error.error ?? "UNKNOWN_ERROR"}</p>
          {props.error.conflictFields?.length ? <p className="mt-1">冲突字段：{props.error.conflictFields.join("、")}</p> : null}
          {props.error.latest !== undefined ? <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-zinc-300">{JSON.stringify(props.error.latest, null, 2)}</pre> : null}
          <p className="mt-2 text-zinc-400">草稿与幂等键已保留。刷新查看最新排期后再决定是否重试。</p>
          {safeConflictWorkbench(props.error.workbench) ? <Link className="mt-2 inline-flex text-teal-300 hover:underline" href={safeConflictWorkbench(props.error.workbench)!}>打开当前活动</Link> : null}
        </div>
      ) : null}
      {props.access === "stale" && props.remoteDraft ? <p role="status" className="text-xs text-amber-200">检测到外部草稿 revision {props.remoteDraft.draftRevision}；本页不会自动采用或回写。</p> : null}
      {props.conflict && !props.conflictOpen ? <Button type="button" variant="ghost" size="sm" className="w-fit text-amber-200 underline" onClick={props.onOpenConflict}>处理复习确认冲突</Button> : null}
    </>
  );
}
