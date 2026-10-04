"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { MessageSquareWarning, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Alert, Badge, Skeleton } from "@/components/ui/feedback";
import {
  listRankingAppeals,
  submitRankingAppeal,
  transitionRankingAppeal,
} from "@/lib/api/ranking";
import { isConflict } from "@/lib/client/api-errors";
import { formatDateTimeShort } from "@/lib/formatters";
import type { RankingAppealDto } from "@/lib/ranking/contracts";

type AppealAction = "review" | "accept" | "reject" | "withdraw";

export interface RankingAppealPanelProps {
  challengeId: string;
  currentUserId: string;
  ownerUserId: string | null;
  participantId: string | null;
  participantStatus: string | null;
  participantLabels: Record<string, string>;
}

export function RankingAppealPanel(props: RankingAppealPanelProps) {
  const fieldId = useId();
  const [appeals, setAppeals] = useState<RankingAppealDto[]>([]);
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = props.ownerUserId === props.currentUserId;
  const canAccess = isOwner || props.participantStatus === "ACTIVE";
  const canSubmit = props.participantStatus === "ACTIVE" && props.participantId !== null;
  const ownOpenAppeal = appeals.some((appeal) =>
    appeal.submittedByUserId === props.currentUserId && isOpenAppeal(appeal));
  const reasonError = reasonTouched ? validateAppealReason(reason) : null;

  const load = useCallback(async (showLoading = true) => {
    if (!canAccess) return;
    if (showLoading) setPending("load");
    setError(null);
    const result = await listRankingAppeals(props.challengeId);
    if (result.ok) setAppeals(result.body?.appeals ?? []);
    else setError(appealErrorMessage(result, "申诉读取失败，请重试。"));
    if (showLoading) setPending(null);
  }, [canAccess, props.challengeId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (!canAccess) return null;

  async function submit() {
    setReasonTouched(true);
    const validationError = validateAppealReason(reason);
    if (validationError || !props.participantId) return;
    setPending("submit");
    setError(null);
    const result = await submitRankingAppeal(props.challengeId, {
      participantId: props.participantId,
      reason: reason.trim(),
    });
    setPending(null);
    if (!result.ok || !result.body?.appeal) {
      setError(appealErrorMessage(result, "申诉提交失败，请检查内容后重试。"));
      if (isConflict(result)) await load(false);
      return;
    }
    setAppeals((current) => [result.body!.appeal!, ...current]);
    setReason("");
    setReasonTouched(false);
    setFormOpen(false);
    setNotice("申诉已提交；挑战 Owner 处理前不会改写排名或学习记录。");
  }

  async function transition(appeal: RankingAppealDto, action: AppealAction) {
    const actionKey = `${appeal.appealId}:${action}`;
    setPending(actionKey);
    setError(null);
    const result = await transitionRankingAppeal(
      props.challengeId,
      appeal.appealId,
      action,
      appeal.revision,
    );
    setPending(null);
    if (!result.ok || !result.body?.appeal) {
      setError(appealErrorMessage(result, "申诉状态更新失败，请重试。"));
      if (isConflict(result)) await load(false);
      return;
    }
    setAppeals((current) => current.map((item) =>
      item.appealId === appeal.appealId ? result.body!.appeal! : item));
    setNotice(appealActionSuccess(action));
  }

  return (
    <section className="space-y-3 border-t border-white/10 pt-4" aria-labelledby={`${fieldId}-title`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`${fieldId}-title`} className="flex items-center gap-2 text-sm font-medium text-zinc-100">
            <MessageSquareWarning className="size-4 text-amber-300" aria-hidden="true" />
            排名申诉
          </h3>
          <p className="mt-1 text-xs leading-5 text-zinc-400">申诉只复核当前排名投影，不修改任务、计时或复盘源记录。</p>
        </div>
        <Button className="min-h-11" disabled={pending !== null} onClick={() => void load()} size="sm" type="button" variant="secondary">
          <RefreshCw className="size-3.5" aria-hidden="true" />刷新申诉
        </Button>
      </header>

      {notice ? <Alert tone="info" role="status">{notice}</Alert> : null}
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}

      {canSubmit && !ownOpenAppeal && !formOpen ? <Button className="min-h-11" disabled={pending !== null} onClick={() => setFormOpen(true)} type="button" variant="secondary">提出申诉</Button> : null}
      {canSubmit && !ownOpenAppeal && formOpen ? (
        <div className="space-y-2 rounded-xl border border-white/10 bg-black/10 p-3">
          <label className="block text-sm text-zinc-300" htmlFor={`${fieldId}-reason`}>说明需要复核的异常</label>
          <Textarea
            id={`${fieldId}-reason`}
            aria-describedby={reasonError ? `${fieldId}-reason-error` : `${fieldId}-reason-help`}
            aria-invalid={reasonError ? true : undefined}
            className="min-h-24"
            disabled={pending !== null}
            maxLength={500}
            onBlur={() => setReasonTouched(true)}
            onChange={(event) => setReason(event.target.value)}
            placeholder="例如：重复同步导致有效时长被计入两次"
            value={reason}
          />
          {reasonError ? <p id={`${fieldId}-reason-error`} className="text-xs leading-5 text-rose-300" role="alert">{reasonError}</p>
            : <p id={`${fieldId}-reason-help`} className="text-xs leading-5 text-zinc-500">1–500 字；正文仅自己和挑战 Owner 可见。</p>}
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" disabled={pending !== null || reason.trim().length === 0} onClick={() => void submit()} type="button">{pending === "submit" ? "正在提交" : "提交申诉"}</Button>
            <Button className="min-h-11" disabled={pending !== null} onClick={() => { setFormOpen(false); setReasonTouched(false); }} type="button" variant="secondary">暂不提交</Button>
          </div>
        </div>
      ) : null}

      {pending === "load" && appeals.length === 0 ? <div className="space-y-2"><Skeleton /><Skeleton className="h-16" /></div> : null}
      {pending !== "load" && appeals.length === 0 ? <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-sm text-zinc-500">当前没有申诉记录。</p> : null}
      {appeals.length > 0 ? <div className="space-y-2">{appeals.map((appeal) => (
        <AppealRow
          key={appeal.appealId}
          appeal={appeal}
          currentUserId={props.currentUserId}
          isOwner={isOwner}
          label={props.participantLabels[appeal.participantId] ?? "挑战成员"}
          pending={pending}
          onTransition={transition}
        />
      ))}</div> : null}
    </section>
  );
}

function AppealRow(props: {
  appeal: RankingAppealDto;
  currentUserId: string;
  isOwner: boolean;
  label: string;
  pending: string | null;
  onTransition: (appeal: RankingAppealDto, action: AppealAction) => Promise<void>;
}) {
  const appeal = props.appeal;
  const canWithdraw = appeal.submittedByUserId === props.currentUserId && isOpenAppeal(appeal);
  return (
    <article className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-zinc-200">{props.label}</span><Badge tone={appealTone[appeal.status]}>{appealLabel[appeal.status]}</Badge></div>
        <time className="text-xs text-zinc-500" dateTime={appeal.updatedAt}>{formatDateTimeShort(appeal.updatedAt)}</time>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">{appeal.reason ?? "申诉正文不可见"}</p>
      <div className="flex flex-wrap gap-2">
        {props.isOwner && appeal.status === "OPEN" ? <AppealButton appeal={appeal} action="review" label="开始复核" pending={props.pending} onTransition={props.onTransition} /> : null}
        {props.isOwner && appeal.status === "UNDER_REVIEW" ? <><AppealButton appeal={appeal} action="accept" label="接受申诉" pending={props.pending} onTransition={props.onTransition} /><AppealButton appeal={appeal} action="reject" label="驳回申诉" pending={props.pending} onTransition={props.onTransition} /></> : null}
        {canWithdraw ? <AppealButton appeal={appeal} action="withdraw" label="撤回申诉" pending={props.pending} onTransition={props.onTransition} /> : null}
      </div>
    </article>
  );
}

function AppealButton(props: { appeal: RankingAppealDto; action: AppealAction; label: string; pending: string | null; onTransition: (appeal: RankingAppealDto, action: AppealAction) => Promise<void> }) {
  const actionKey = `${props.appeal.appealId}:${props.action}`;
  return <Button className="min-h-11" disabled={props.pending !== null} onClick={() => void props.onTransition(props.appeal, props.action)} size="sm" type="button" variant={props.action === "accept" ? "primary" : "secondary"}>{props.pending === actionKey ? "处理中" : props.label}</Button>;
}

function validateAppealReason(value: string): string | null {
  const length = value.trim().length;
  if (length === 0) return "请填写需要复核的具体异常。";
  if (length > 500) return "申诉说明不能超过 500 字。";
  return null;
}

function isOpenAppeal(appeal: RankingAppealDto): boolean {
  return appeal.status === "OPEN" || appeal.status === "UNDER_REVIEW";
}

function appealErrorMessage(result: { status: number; body?: { error?: string } | null }, fallback: string): string {
  const code = result.body?.error;
  if (result.status === 0) return "网络不可用，请恢复连接后重试；当前页面状态未改变。";
  if (code === "RANKING_APPEAL_ALREADY_OPEN") return "已有未结束的申诉，请先等待处理或撤回原申诉。";
  if (code === "RANKING_APPEAL_PROJECTION_NOT_FOUND") return "当前还没有可申诉的排名，请先让挑战 Owner 重建排名。";
  if (code === "RANKING_APPEAL_PROJECTION_STALE") return "排名已经变化，请刷新榜单后重新提交。";
  if (isConflict(result)) return "申诉状态已经变化，已重新载入最新结果。";
  return fallback;
}

function appealActionSuccess(action: AppealAction): string {
  if (action === "review") return "已开始复核；排名和学习源记录保持不变。";
  if (action === "accept") return "已接受申诉；后续排名重建仍需显式执行。";
  if (action === "reject") return "已驳回申诉；原排名投影保持不变。";
  return "申诉已撤回。";
}

const appealLabel: Record<RankingAppealDto["status"], string> = {
  OPEN: "待复核",
  UNDER_REVIEW: "复核中",
  ACCEPTED: "已接受",
  REJECTED: "已驳回",
  WITHDRAWN: "已撤回",
};

const appealTone: Record<RankingAppealDto["status"], "neutral" | "info" | "success" | "warning" | "danger"> = {
  OPEN: "info",
  UNDER_REVIEW: "warning",
  ACCEPTED: "success",
  REJECTED: "danger",
  WITHDRAWN: "neutral",
};
