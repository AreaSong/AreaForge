"use client";

import { isConflict, isUnauthorized } from "@/lib/client/api-errors";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { correctReviewEvent, type ReviewResult } from "@/lib/api/review-actions";
import {
  loadPrivateBusinessDraft,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
  SHORT_PRIVATE_DRAFT_TTL_MS,
} from "@/lib/client/private-business-drafts";
import type { ReviewEventDto } from "@/lib/contracts";

type Result = ReviewResult;

export function ReviewEventCorrection(props: { event: ReviewEventDto; scheduleRevision: number }) {
  const router = useRouter();
  const draftKey = `areaforge.quick-review.correction.${props.event.id}`;
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Result>(props.event.result);
  const [nextDueDate, setNextDueDate] = useState("");
  const [note, setNote] = useState(props.event.note ?? "");
  const [idempotencyKey, setIdempotencyKey] = useState(() => createCorrectionKey(props.event.id));
  const [baseRevision, setBaseRevision] = useState(props.scheduleRevision);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ latest?: unknown; conflictFields: string[] } | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = loadPrivateBusinessDraft(draftKey, SHORT_PRIVATE_DRAFT_TTL_MS, isCorrectionDraft);
      if (!saved) return;
      setResult(saved.result);
      setNextDueDate(saved.nextDueDate);
      setNote(saved.note);
      setIdempotencyKey(saved.idempotencyKey);
      setBaseRevision(saved.baseRevision);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftKey]);

  useEffect(() => {
    if (!open) return;
    savePrivateBusinessDraft(draftKey, { result, nextDueDate, note, idempotencyKey, baseRevision });
  }, [baseRevision, draftKey, idempotencyKey, nextDueDate, note, open, result]);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const response = await correctReviewEvent(props.event.id, {
        idempotencyKey,
        expectedRevision: baseRevision,
        result,
        nextDueDate: nextDueDate || undefined,
        note: note || undefined,
      });
      const body = response.body;
      if (isUnauthorized(response)) {
        setError("登录已过期，更正输入与命令身份仍保留；重新登录后请显式重试。");
        return redirectToLoginWithCurrentLocation();
      }
      if (response.status === 404) {
        setError("原复习事件已不存在，更正输入仍保留；正在返回统一复习工作台。");
        router.replace(body?.workbench === "/knowledge/reviews" ? body.workbench : "/knowledge/reviews");
        return;
      }
      if (!response.ok) {
      if (isConflict(response)) {
          setConflict({ latest: body?.latest, conflictFields: body?.conflictFields ?? ["revision"] });
          setConflictOpen(true);
        }
        setError(`${body?.error ?? "更正失败，当前输入仍保留"}${body?.conflictFields?.length ? `（${body.conflictFields.join("、")}）` : ""}`);
        return;
      }
      removePrivateBusinessDraft(draftKey);
      setOpen(false);
      router.refresh();
    } catch {
      setError("网络不可用，更正输入仍保留；恢复网络后请显式重试。");
    } finally {
      setSubmitting(false);
    }
  }

  function adoptLatest() {
    removePrivateBusinessDraft(draftKey);
    setConflict(null);
    setConflictOpen(false);
    setOpen(false);
    router.refresh();
  }

  function mergeOntoLatest() {
    const revision = readCorrectionRevision(conflict?.latest);
    if (revision === null) {
      setConflictOpen(false);
      setError("当前事件已不是最新有效事件，不能把旧更正强制覆盖到新事件；请刷新后更正最新结果。");
      router.refresh();
      return;
    }
    setBaseRevision(revision);
    setIdempotencyKey(createCorrectionKey(props.event.id));
    setConflict(null);
    setConflictOpen(false);
    setError(`已基于服务端 r${revision} 重建更正命令；输入仍保留，请检查后显式重试。`);
  }

  if (!open) {
    return <Button type="button" variant="ghost" size="sm" className="mt-2 !h-auto !min-h-0 !px-0 !py-0 !text-xs !font-normal text-teal-300 hover:!bg-transparent hover:underline" onClick={() => setOpen(true)}>更正最新结果</Button>;
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border border-white/10 bg-black/20 p-3">
      <p className="text-xs text-zinc-400">更正会追加新事件，原事件保持不变，时长沿用 {props.event.durationSeconds} 秒。</p>
      <Field label="结果" htmlFor="review-correction-result"><Select id="review-correction-result" className="mt-1" value={result} onChange={(event) => setResult(event.target.value as Result)}><option value="PASSED">通过</option><option value="PARTIAL">部分</option><option value="FAILED">失败</option></Select></Field>
      <Field label="下次日期（可选）" htmlFor="review-correction-next-due"><Input id="review-correction-next-due" type="date" className="mt-1" value={nextDueDate} onChange={(event) => setNextDueDate(event.target.value)} /></Field>
      <Field label="更正备注" htmlFor="review-correction-note"><Textarea id="review-correction-note" className="mt-1" controlHeight="sm" value={note} onChange={(event) => setNote(event.target.value)} /></Field>
      <div className="flex gap-2"><Button type="button" variant="primary" loading={submitting} loadingLabel="提交中..." onClick={() => void submit()}>提交更正</Button><Button type="button" variant="secondary" onClick={() => setOpen(false)}>取消</Button></div>
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
      {conflict && !conflictOpen ? <Button type="button" variant="ghost" size="sm" className="!h-auto !min-h-0 !px-0 !py-0 !text-sm !font-normal text-amber-200 hover:!bg-transparent hover:underline" onClick={() => setConflictOpen(true)}>处理更正冲突</Button> : null}
      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="合并复习更正冲突"
        description="服务端最新有效事件或排期 revision 已变化。旧更正不会被自动重放。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={[
          { field: "revision", label: "排期 revision", local: baseRevision, server: readCorrectionRevision(conflict?.latest) },
          { field: "result", label: "更正结果", local: result, server: readCorrectionField(conflict?.latest, "result") },
          { field: "nextDueDate", label: "下次日期", local: nextDueDate, server: readCorrectionField(conflict?.latest, "nextDueDate") },
          { field: "note", label: "更正备注", local: note, server: readCorrectionField(conflict?.latest, "note") },
        ]}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={adoptLatest}
        onManualMerge={mergeOntoLatest}
        adoptLabel="采用服务端并关闭旧更正"
        mergeLabel="基于最新排期重建更正"
      />
    </div>
  );
}

function createCorrectionKey(eventId: string): string {
  return `review-correction-${eventId}-${crypto.randomUUID()}`;
}

function isCorrectionDraft(value: unknown): value is {
  result: Result;
  nextDueDate: string;
  note: string;
  idempotencyKey: string;
  baseRevision: number;
} {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  return ["PASSED", "PARTIAL", "FAILED"].includes(String(draft.result))
    && typeof draft.nextDueDate === "string"
    && typeof draft.note === "string"
    && typeof draft.idempotencyKey === "string"
    && typeof draft.baseRevision === "number";
}

function readCorrectionRevision(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const latest = record.schedule && typeof record.schedule === "object"
    ? record.schedule as { revision?: unknown }
    : record as { revision?: unknown };
  return typeof latest.revision === "number" ? latest.revision : null;
}

function readCorrectionField(value: unknown, field: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.event && typeof record.event === "object" && field in record.event) {
    return (record.event as Record<string, unknown>)[field];
  }
  if (record.schedule && typeof record.schedule === "object" && field in record.schedule) {
    return (record.schedule as Record<string, unknown>)[field];
  }
  return record[field];
}
