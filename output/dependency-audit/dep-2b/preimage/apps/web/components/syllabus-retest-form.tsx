"use client";

import { addSyllabusMasteryRetest } from "@/lib/api/syllabus";
import { mutationFeedback } from "@/lib/client/mutation-feedback";
import { RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import {
  LONG_PRIVATE_DRAFT_TTL_MS,
  loadPrivateBusinessDraft,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import {
  isShanghaiDateInputError,
  shanghaiDateInputToIso,
  shanghaiDateTimeInputToIso,
} from "@/lib/formatters";

interface RetestDraft {
  result: "passed" | "partial" | "failed";
  testedAt: string;
  score: string;
  summary: string;
  nextReviewDate: string;
}

const initialDraft: RetestDraft = {
  result: "partial",
  testedAt: "",
  score: "",
  summary: "",
  nextReviewDate: "",
};

export function SyllabusRetestForm(props: {
  nodeId: string;
  onCancel: () => void;
  onSaved: (result: { retestId?: string }) => void | Promise<void>;
  draftScope?: string;
  commandScope?: string;
  compact?: boolean;
}) {
  const draftKey = `areaforge.syllabus.draft.retest.${props.draftScope ?? props.nodeId}`;
  const commandScope = props.commandScope ?? `mastery-retest:${props.nodeId}:canonical`;
  const [draft, setDraft] = useState(initialDraft);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = loadPrivateBusinessDraft(draftKey, LONG_PRIVATE_DRAFT_TTL_MS, isRetestDraft);
      if (saved) setDraft(saved);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftKey]);

  useEffect(() => {
    if (!hydrated) return;
    if (JSON.stringify(draft) === JSON.stringify(initialDraft)) removePrivateBusinessDraft(draftKey);
    else savePrivateBusinessDraft(draftKey, draft);
  }, [draft, draftKey, hydrated]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        testedAt: draft.testedAt ? shanghaiDateTimeInputToIso(draft.testedAt) : undefined,
        result: draft.result,
        score: draft.score.trim() || undefined,
        summary: draft.summary.trim() || undefined,
        nextReviewAt: draft.nextReviewDate ? shanghaiDateInputToIso(draft.nextReviewDate) : null,
      };
      const response = await addSyllabusMasteryRetest(props.nodeId, {
        idempotencyKey: getOrCreateIdempotencyKey(commandScope, "mastery-retest", payload),
        ...payload,
      });
      const body = response.body;
      if (!response.ok) {
        savePrivateBusinessDraft(draftKey, draft);
        const feedback = mutationFeedback(response, "复测记录保存失败，输入和重试身份仍保留");
        if (feedback.kind === "unauthorized") redirectToLoginWithCurrentLocation();
        setError(feedback.message);
        return;
      }
      await props.onSaved({ retestId: body?.retestId });
      completeIdempotentCommand(commandScope);
      removePrivateBusinessDraft(draftKey);
    } catch (caught) {
      savePrivateBusinessDraft(draftKey, draft);
      setError(isShanghaiDateInputError(caught)
        ? "复测时间或下次复习日期无效，请重新选择。"
        : caught instanceof Error
          ? caught.message
          : "网络中断，输入与同一重试身份已保留；恢复网络后请显式重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={props.compact ? "space-y-4" : "space-y-4 border-y border-white/10 py-5"} onSubmit={submit}>
      {!props.compact ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">记录复测</h2>
          <Button type="button" variant="ghost" size="md" className="px-2" onClick={props.onCancel}>
            <X className="h-4 w-4" aria-hidden="true" />关闭复测
          </Button>
        </div>
      ) : null}
      <div className="af-content-grid-two grid gap-4">
        <Field label="结果" htmlFor="syllabus-retest-result">
          <Select id="syllabus-retest-result" className="h-11 bg-[#0d1117] text-white" value={draft.result} onChange={(event) => setDraft((current) => ({ ...current, result: event.target.value as RetestDraft["result"] }))}>
            <option value="passed">通过</option><option value="partial">部分通过</option><option value="failed">未通过</option>
          </Select>
        </Field>
        <Field label="复测时间（可选）" htmlFor="syllabus-retest-tested-at"><Input id="syllabus-retest-tested-at" className="h-11 bg-[#0d1117] text-white" type="datetime-local" value={draft.testedAt} onChange={(event) => setDraft((current) => ({ ...current, testedAt: event.target.value }))} /></Field>
        <Field label="得分（可选）" htmlFor="syllabus-retest-score"><Input id="syllabus-retest-score" className="h-11 bg-[#0d1117] text-white" value={draft.score} maxLength={80} onChange={(event) => setDraft((current) => ({ ...current, score: event.target.value }))} /></Field>
        <Field label="下次复习日期（可选）" htmlFor="syllabus-retest-next-review"><Input id="syllabus-retest-next-review" className="h-11 bg-[#0d1117] text-white" type="date" value={draft.nextReviewDate} onChange={(event) => setDraft((current) => ({ ...current, nextReviewDate: event.target.value }))} /></Field>
      </div>
      <Field label="复测摘要" htmlFor="syllabus-retest-summary"><Textarea id="syllabus-retest-summary" controlHeight="lg" className="bg-[#0d1117] text-white" value={draft.summary} maxLength={2000} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} /></Field>
      {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
      <Button type="submit" variant="primary" size="lg" disabled={saving}>
        <RotateCcw className="h-4 w-4" aria-hidden="true" />{saving ? "保存中" : "保存复测"}
      </Button>
    </form>
  );
}

function isRetestDraft(value: unknown): value is RetestDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Partial<RetestDraft>;
  return ["passed", "partial", "failed"].includes(draft.result ?? "") && typeof draft.testedAt === "string" && typeof draft.score === "string" && typeof draft.summary === "string" && typeof draft.nextReviewDate === "string";
}
