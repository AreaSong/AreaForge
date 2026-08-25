"use client";

import {
  confirmKnowledgeRetest,
  startKnowledgeRetest,
  submitKnowledgeRetest,
  type KnowledgeRetestCommandInput,
  type SubmitKnowledgeRetestInput,
} from "@/lib/api/knowledge-retest";
import { ArrowLeft, BadgeCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { Alert, Badge } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { StudyActivityTimer } from "@/components/study-activity-timer";
import { publishActivityStatus } from "@/lib/client/activity-status";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import { getReturnContextLabel } from "@/lib/navigation/return-context";
import { formatDatePadded } from "@/lib/formatters";
import type { KnowledgeRetestDetailDto, KnowledgeRetestResultDto } from "@/lib/contracts";

type RetestMutationCommand =
  | { action: "start" | "confirm"; payload: KnowledgeRetestCommandInput }
  | { action: "submit"; payload: SubmitKnowledgeRetestInput; completingTimer: boolean };

interface RetestConflict {
  command: RetestMutationCommand;
  latest: KnowledgeRetestDetailDto | null;
  conflictFields: string[];
}

export function KnowledgeRetestDetailClient({ initial, userId, returnTo = "/test/retests", initialNow, embeddedInWorkbench = false }: { initial: KnowledgeRetestDetailDto; userId: string; returnTo?: string; initialNow: string; embeddedInWorkbench?: boolean }) {
  const router = useRouter();
  const [retest, setRetest] = useState(initial);
  const [points, setPoints] = useState(() => initial.points.map((point) => ({ ...point, result: point.result })));
  const [summary, setSummary] = useState(initial.summary ?? "");
  const [reviewText, setReviewText] = useState(initial.reviewText ?? "");
  const [timerCloseoutPending, setTimerCloseoutPending] = useState(initial.status === "IN_PROGRESS" && !initial.timerSessionId);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<RetestConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function start() {
    const scope = `knowledge-retest:${retest.id}:start`;
    const expected = { expectedRevision: retest.revision };
    executeMutation({
      action: "start",
      payload: {
        idempotencyKey: getOrCreateIdempotencyKey(scope, "knowledge-retest-start", expected),
        ...expected,
      },
    });
  }

  function submit() {
    if (!summary.trim() || !reviewText.trim()) {
      setError("完成每个知识点结果后，还必须写复测总结和复盘。");
      return;
    }
    const incomplete = points.filter((point) => !point.result || point.score == null || !point.note?.trim());
    if (incomplete.length > 0) {
      setError("每个知识点都必须填写通过情况、量化分数和个人反馈后才能提交。");
      return;
    }
    const completingTimer = Boolean(retest.timerSessionId);
    const payload = {
      expectedRevision: retest.revision,
      summary,
      reviewText,
      points: points.map((point) => ({ pointId: point.id, result: point.result as KnowledgeRetestResultDto, score: point.score, understanding: point.understanding, note: point.note })),
    };
    const scope = `knowledge-retest:${retest.id}:submit`;
    executeMutation({
      action: "submit",
      completingTimer,
      payload: {
        idempotencyKey: getOrCreateIdempotencyKey(scope, "knowledge-retest-submit", payload),
        ...payload,
      },
    });
  }

  function confirm() {
    const scope = `knowledge-retest:${retest.id}:confirm`;
    const expected = { expectedRevision: retest.revision };
    executeMutation({
      action: "confirm",
      payload: {
        idempotencyKey: getOrCreateIdempotencyKey(scope, "knowledge-retest-confirm", expected),
        ...expected,
      },
    });
  }

  function executeMutation(command: RetestMutationCommand) {
    startTransition(async () => {
      const scope = `knowledge-retest:${retest.id}:${command.action}`;
      try {
        const response = command.action === "start"
          ? await startKnowledgeRetest(retest.id, command.payload)
          : command.action === "submit"
            ? await submitKnowledgeRetest(retest.id, command.payload)
            : await confirmKnowledgeRetest(retest.id, command.payload);
        const body = response.body;
        if (isUnauthorized(response)) {
          setError("登录已过期，复测输入仍保留；重新登录后请显式重试。");
          redirectToLoginWithCurrentLocation();
          return;
        }
        if (!response.ok || !body?.retest) {
          if (isConflict(response)) {
            setConflict({
              command: freezeRetestCommand(command),
              latest: isKnowledgeRetestDetail(body?.latest) ? body.latest : null,
              conflictFields: body?.conflictFields ?? ["revision"],
            });
            setConflictOpen(true);
          }
          setError(body?.error ?? "复测状态已变化，本地输入仍保留；请处理冲突后重试。");
          return;
        }
        completeIdempotentCommand(scope);
        setRetest(body.retest);
        if (command.action === "submit" && (command.completingTimer || timerCloseoutPending)) {
          publishActivityStatus(userId, null);
          setTimerCloseoutPending(false);
        }
        if (command.action !== "submit") setTimerCloseoutPending(false);
        if (command.action === "confirm") router.refresh();
      } catch {
        setError("网络不可用，复测输入仍保留；恢复网络后请显式重试。");
      }
    });
  }

  function adoptServerVersion() {
    if (!conflict) return;
    const latest = conflict.latest;
    setConflict(null);
    setConflictOpen(false);
    if (!latest) {
      setError("服务端没有可采用的复测版本，请刷新后确认当前状态。");
      router.refresh();
      return;
    }
    setRetest(latest);
    setPoints(latest.points.map((point) => ({ ...point, result: point.result })));
    setSummary(latest.summary ?? "");
    setReviewText(latest.reviewText ?? "");
    setTimerCloseoutPending(latest.status === "IN_PROGRESS" && !latest.timerSessionId);
    setError(`已采用服务端最新复测版本 r${latest.revision}，原命令未重放。`);
  }

  function retryOnLatest() {
    if (!conflict) return;
    const current = conflict;
    const revision = current.latest?.revision;
    const command = revision === undefined
      ? current.command
      : current.command.action === "submit"
        ? { ...current.command, payload: { ...current.command.payload, expectedRevision: revision } }
        : { ...current.command, payload: { ...current.command.payload, expectedRevision: revision } };
    if (current.latest) {
      setRetest((value) => ({ ...value, revision: current.latest!.revision, status: current.latest!.status, timerSessionId: current.latest!.timerSessionId }));
    }
    setConflict(null);
    setConflictOpen(false);
    setError("本地复测输入已保留，正在按服务端最新 revision 显式重试。");
    executeMutation(command as RetestMutationCommand);
  }

  /*
   * The submit payload is copied before it enters the async boundary so edits
   * made while a request is in flight cannot mutate the retry intent.
   */
  function freezeRetestCommand(command: RetestMutationCommand): RetestMutationCommand {
    return command.action === "submit"
      ? { ...command, payload: { ...command.payload, points: command.payload.points.map((point) => ({ ...point })) } }
      : { ...command, payload: { ...command.payload } };
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        {embeddedInWorkbench ? <span className="text-xs text-zinc-500">公共窗口 · 专项复测</span> : <Link href={returnTo} className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white"><ArrowLeft size={16} aria-hidden="true" />{getReturnContextLabel(returnTo, "返回专项复测")}</Link>}
        <Badge tone={retest.status === "CLOSED" ? "success" : retest.status === "PENDING_REVIEW" ? "warning" : "info"}>{statusLabel(retest.status, retest.result)}</Badge>
      </div>
      <div><h1 className="text-2xl font-semibold text-white">{retest.title}</h1><p className="mt-2 text-sm text-zinc-400">{retest.method} · {retest.pointCount} 个知识点</p></div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {retest.status === "DRAFT" ? <Button type="button" variant="primary" onClick={start} loading={pending}>开始复测</Button> : null}
      {retest.status === "IN_PROGRESS" && retest.timerSessionId ? (
        <StudyActivityTimer
          userId={userId}
          sessionId={retest.timerSessionId}
          theme="review"
          label="专项复测计时"
          initialNow={initialNow}
          onFinished={() => {
            setRetest((current) => ({ ...current, timerSessionId: null }));
            setTimerCloseoutPending(true);
          }}
        />
      ) : null}
      <section className="space-y-3">
        <h2 className="text-lg font-medium text-white">逐点结果</h2>
        <div className="divide-y divide-white/10 border-y border-white/10">
          {points.map((point, index) => (
            <div key={point.id} className="af-retest-entry-grid grid min-w-0 gap-3 py-4">
              <div>
                <p className="text-sm font-medium text-white">{index + 1}. {point.title}</p>
                <Textarea
                  aria-label={`${point.title}个人反馈`}
                  value={point.note ?? ""}
                  onChange={(event) => updatePoint(point.id, { note: event.target.value })}
                  placeholder="个人反馈：哪里清楚、哪里仍然卡住"
                  maxLength={2000}
                  controlHeight="sm"
                  className="mt-2 bg-[var(--af-surface-raised)] text-sm text-white placeholder:text-zinc-600"
                  disabled={retest.status !== "IN_PROGRESS" || Boolean(retest.timerSessionId)}
                />
              </div>
              <Select
                aria-label={`${point.title}结果`}
                value={point.result ?? ""}
                onChange={(event) => updatePoint(point.id, { result: (event.target.value || null) as KnowledgeRetestResultDto | null })}
                className="min-w-0 bg-[var(--af-surface-raised)] px-2 text-sm text-white"
                disabled={retest.status !== "IN_PROGRESS" || Boolean(retest.timerSessionId)}
              >
                <option value="">选择结果</option>
                <option value="PASSED">通过</option>
                <option value="PARTIAL">部分掌握</option>
                <option value="FAILED">未通过</option>
              </Select>
              <Input
                type="number"
                min={0}
                max={100}
                value={point.score ?? ""}
                onChange={(event) => updatePoint(point.id, { score: event.target.value ? Number(event.target.value) : null })}
                placeholder="量化分数"
                aria-label={`${point.title}量化分数`}
                className="min-w-0 bg-[var(--af-surface-raised)] px-2 text-sm text-white placeholder:text-zinc-600"
                disabled={retest.status !== "IN_PROGRESS" || Boolean(retest.timerSessionId)}
              />
            </div>
          ))}
        </div>
      </section>
      {retest.status === "IN_PROGRESS" && !retest.timerSessionId ? (
        <section className="space-y-3">
          <Field label="复测总结" htmlFor="knowledge-retest-summary">
            <Textarea id="knowledge-retest-summary" value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={4000} className="bg-[var(--af-surface-raised)] text-white" />
          </Field>
          <Field label="复盘" htmlFor="knowledge-retest-review">
            <Textarea id="knowledge-retest-review" value={reviewText} onChange={(event) => setReviewText(event.target.value)} maxLength={4000} className="min-h-28 bg-[var(--af-surface-raised)] text-white" />
          </Field>
          <Button type="button" variant="primary" onClick={submit} loading={pending}>提交复测，进入确认</Button>
        </section>
      ) : null}
      {retest.status === "PENDING_REVIEW" ? <section className="space-y-3 border border-amber-300/20 bg-amber-400/5 p-4"><p className="text-sm text-amber-100">结果、总结和复盘已保存。确认后才会更新知识点掌握状态，并安排下一次复测。</p><Button type="button" variant="primary" onClick={confirm} loading={pending}><BadgeCheck size={16} aria-hidden="true" />确认并更新掌握状态</Button></section> : null}
      {retest.status === "CLOSED" ? <Alert tone="success">已确认。下一次复测：{retest.nextDueAt ? formatDatePadded(retest.nextDueAt) : "待安排"}。</Alert> : null}
      {conflict && !conflictOpen ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setConflictOpen(true)}>处理复测冲突</Button>
          <Button type="button" variant="ghost" size="sm" onClick={retryOnLatest}>保留输入并重试</Button>
        </div>
      ) : null}
      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="专项复测版本冲突"
        description="服务端复测版本已变化。当前逐点输入、总结和复盘仍保留，原命令不会自动重放。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={conflict ? retestConflictComparisons(conflict) : []}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={adoptServerVersion}
        onManualMerge={retryOnLatest}
        mergeLabel="保留输入并重试"
      />
    </div>
  );

  function updatePoint(id: string, patch: Partial<typeof points[number]>) {
    setPoints((current) => current.map((point) => point.id === id ? { ...point, ...patch } : point));
  }
}

function retestConflictComparisons(conflict: RetestConflict) {
  const latest = conflict.latest;
  const local = conflict.command.payload;
  return [
    { field: "revision", label: "复测 revision", local: local.expectedRevision, server: latest?.revision ?? "未知" },
    { field: "status", label: "复测状态", local: conflict.command.action, server: latest?.status ?? "未知" },
    ...(conflict.command.action === "submit" ? [
      { field: "summary", label: "复测总结", local: conflict.command.payload.summary, server: latest?.summary ?? "未设置" },
      { field: "reviewText", label: "复盘", local: conflict.command.payload.reviewText, server: latest?.reviewText ?? "未设置" },
    ] : []),
  ];
}

function isKnowledgeRetestDetail(value: unknown): value is KnowledgeRetestDetailDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const detail = value as Partial<KnowledgeRetestDetailDto>;
  return typeof detail.id === "string"
    && typeof detail.revision === "number"
    && typeof detail.title === "string"
    && Array.isArray(detail.points);
}

function statusLabel(status: string, result: string | null): string {
  if (status === "CLOSED") return result === "PASSED" ? "已确认 · 稳定掌握" : result === "PARTIAL" ? "已确认 · 部分掌握" : "已确认 · 需要再测";
  if (status === "PENDING_REVIEW") return "待确认";
  if (status === "IN_PROGRESS") return "进行中";
  return "待开始";
}
