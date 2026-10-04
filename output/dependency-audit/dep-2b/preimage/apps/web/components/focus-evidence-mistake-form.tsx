"use client";

import type React from "react";
import { useEffect, useState } from "react";
import { BookOpenCheck, Bug, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/feedback";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import {
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import { classifyApiFailure } from "@/lib/client/api-errors";
import type { FocusEvidenceReceipt, FocusEvidenceType } from "@/components/focus-session-evidence";
import { createMistake, getMistake, updateMistake } from "@/lib/api/mistakes";
import {
  isShanghaiDateInputError,
  isoToShanghaiDateTimeInput,
  shanghaiDateTimeInputToIso,
} from "@/lib/formatters";
import {
  type EvidenceContext,
  EvidenceHeading,
  type MistakeDraft,
  emptyMistakeDraft,
  isMistakeDraft,
  useEvidenceDraft,
  contextLabel,
  evidenceErrorMessage,
  inputClass,
} from "./focus-evidence-form-helpers";

export function FocusMistakeForm(props: EvidenceContext & {
  editingReceipt?: FocusEvidenceReceipt | null;
  onCancelEdit?: () => void;
  onDeleteReceipt?: (receipt: FocusEvidenceReceipt) => void;
  onEvidenceSaved: (input: { evidenceType: FocusEvidenceType; evidenceId: string; label: string }) => Promise<void>;
  onEvidenceUpdated?: (receipt: FocusEvidenceReceipt) => Promise<void> | void;
}) {
  const isEditing = Boolean(props.editingReceipt && props.editingReceipt.evidenceType === "mistake");
  const draftKey = `areaforge.focus.evidence.mistake.${props.userId}.${props.sessionId}`;
  const commandScope = `focus-mistake:${props.sessionId}`;
  const [draft, setDraft] = useState<MistakeDraft>(emptyMistakeDraft);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEvidenceDraft(draftKey, draft, setDraft, hydrated, setHydrated, isMistakeDraft, emptyMistakeDraft, isEditing);

  useEffect(() => {
    if (!isEditing || !props.editingReceipt) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoadingDetail(true);
      setError(null);
      const res = await getMistake(props.editingReceipt!.evidenceId);
      if (!active) return;
      setLoadingDetail(false);
      if (res.ok && res.body?.mistake) {
        const mistake = res.body.mistake;
        setDraft({
          title: mistake.title,
          questionText: mistake.questionText || "",
          source: mistake.source || "",
          cause: (mistake.cause === "unknown" ? "concept_confusion" : mistake.cause) as MistakeDraft["cause"],
          causeNote: mistake.causeNote || "",
          correctAnswer: mistake.correctAnswer || "",
          correctIdea: mistake.correctIdea || "",
          nextReviewAt: mistake.nextReviewAt ? isoToShanghaiDateTimeInput(mistake.nextReviewAt) : "",
        });
        setExpectedUpdatedAt(mistake.updatedAt);
      } else {
        setError("获取错题详情失败，请重试。");
      }
    });
    return () => {
      active = false;
    };
  }, [isEditing, props.editingReceipt]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || loadingDetail) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        subjectId: props.subjectId,
        syllabusNodeId: props.syllabusNodeId,
        title: draft.title.trim(),
        questionText: draft.questionText.trim(),
        source: draft.source.trim() || null,
        cause: draft.cause,
        causeNote: draft.causeNote.trim() || null,
        correctAnswer: draft.correctAnswer.trim() || null,
        correctIdea: draft.correctIdea.trim(),
        nextReviewAt: draft.nextReviewAt ? shanghaiDateTimeInputToIso(draft.nextReviewAt) : null,
      };

      if (isEditing && props.editingReceipt) {
        const result = await updateMistake(props.editingReceipt.evidenceId, {
          expectedUpdatedAt,
          ...payload,
        });
        if (!result.ok || !result.body?.mistake) {
          const failure = classifyApiFailure(result);
          throw new Error(
            failure.code
            ?? Object.values(failure.fieldErrors).flat()[0]
            ?? "更新错题失败。",
          );
        }
        await props.onEvidenceUpdated?.({
          evidenceType: "mistake",
          evidenceId: props.editingReceipt.evidenceId,
          label: result.body.mistake.title,
        });
        setDraft(emptyMistakeDraft);
      } else {
        const result = await createMistake({
          idempotencyKey: getOrCreateIdempotencyKey(commandScope, "focus-mistake", payload),
          ...payload,
        });
        if (!result.ok) {
          const failure = classifyApiFailure(result);
          if (failure.kind === "unauthorized") {
            redirectToLoginWithCurrentLocation();
            throw new Error("登录已过期，错题草稿与重试身份已保留。重新登录后请显式重试。");
          }
          throw new Error(
            failure.code
            ?? Object.values(failure.fieldErrors).flat()[0]
            ?? "保存错题失败，草稿已保留。",
          );
        }
        if (!result.body?.mistake) throw new Error("保存错题失败，草稿已保留。");
        await props.onEvidenceSaved({ evidenceType: "mistake", evidenceId: result.body.mistake.id, label: result.body.mistake.title });
        completeIdempotentCommand(commandScope);
        removePrivateBusinessDraft(draftKey);
        setDraft(emptyMistakeDraft);
      }
    } catch (caught) {
      setError(isShanghaiDateInputError(caught)
        ? "下次复习时间无效，错题草稿与重试身份已保留。"
        : evidenceErrorMessage(caught, isEditing ? "更新错题失败，请重试。" : "保存错题失败，草稿与重试身份已保留。"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <EvidenceHeading
        icon={<Bug />}
        title={isEditing ? `修改错题记录 · ${props.editingReceipt?.label || ""}` : "记录错题"}
        context={contextLabel(props)}
      />
      <form noValidate className="space-y-3.5" onSubmit={submit}>
        {/* Card 1: Title & Question */}
        <div className="rounded-2xl border border-white/10 bg-[#0e1619]/90 p-4 sm:p-5 shadow-lg space-y-3.5">
          <Field label="错题标题" htmlFor="focus-mistake-title">
            <Input
              id="focus-mistake-title"
              required
              maxLength={180}
              className={inputClass}
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="哪一步或哪类题型出了问题"
              disabled={loadingDetail}
            />
          </Field>
          <Field label="题目正文与条件" htmlFor="focus-mistake-question">
            <Textarea
              id="focus-mistake-question"
              required
              maxLength={10000}
              className={`${inputClass} min-h-24 py-2.5 resize-none leading-relaxed`}
              value={draft.questionText}
              onChange={(event) => setDraft({ ...draft, questionText: event.target.value })}
              placeholder="记录完整题面、边界条件与提问点"
              disabled={loadingDetail}
            />
          </Field>
        </div>

        {/* Card 2: Cause & Analysis */}
        <div className="rounded-2xl border border-white/10 bg-[#0e1619]/90 p-4 sm:p-5 shadow-lg space-y-3.5">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="错因归类" htmlFor="focus-mistake-cause">
              <Select
                id="focus-mistake-cause"
                className={inputClass}
                value={draft.cause}
                onChange={(event) => setDraft({ ...draft, cause: event.target.value as MistakeDraft["cause"] })}
                disabled={loadingDetail}
              >
                <option value="concept_confusion">概念混淆</option>
                <option value="formula_unfamiliar">公式不熟</option>
                <option value="wrong_approach">思路错误</option>
                <option value="careless">粗心算错</option>
                <option value="time_pressure">时间压力</option>
                <option value="unfamiliar_pattern">题型陌生</option>
              </Select>
            </Field>

            <Field label="出处与来源（可选）" htmlFor="focus-mistake-source">
              <Input
                id="focus-mistake-source"
                maxLength={500}
                className={inputClass}
                value={draft.source}
                onChange={(event) => setDraft({ ...draft, source: event.target.value })}
                placeholder="教材、真题年份或试卷题号"
                disabled={loadingDetail}
              />
            </Field>
          </div>

          <Field label="正确思路与识别盲点" htmlFor="focus-mistake-correct-idea">
            <Textarea
              id="focus-mistake-correct-idea"
              required
              maxLength={3000}
              className={`${inputClass} min-h-24 py-2.5 resize-none leading-relaxed`}
              value={draft.correctIdea}
              onChange={(event) => setDraft({ ...draft, correctIdea: event.target.value })}
              placeholder="写清错误发生在哪里，以及下一次看到这道题该如何快速破局..."
              disabled={loadingDetail}
            />
          </Field>
        </div>

        {/* Card 3: Next Review & Submit */}
        <div className="rounded-2xl border border-white/10 bg-[#0e1619]/90 p-4 sm:p-5 shadow-lg flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="flex-1">
            <Field label="下次复习时间（可选）" htmlFor="focus-mistake-next-review">
              <Input
                id="focus-mistake-next-review"
                type="datetime-local"
                className={inputClass}
                value={draft.nextReviewAt}
                onChange={(event) => setDraft({ ...draft, nextReviewAt: event.target.value })}
                disabled={loadingDetail}
              />
            </Field>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isEditing && props.editingReceipt ? (
              <Button
                type="button"
                variant="danger"
                onClick={() => props.onDeleteReceipt?.(props.editingReceipt!)}
                disabled={saving || loadingDetail}
                leftIcon={<Trash2 className="size-4" aria-hidden="true" />}
              >
                删除此条
              </Button>
            ) : null}

            {isEditing ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setDraft(emptyMistakeDraft);
                  props.onCancelEdit?.();
                }}
                disabled={saving || loadingDetail}
                leftIcon={<X className="size-4" aria-hidden="true" />}
              >
                取消修改
              </Button>
            ) : null}

            <Button
              type="submit"
              variant="primary"
              disabled={saving || loadingDetail || !draft.title.trim() || !draft.questionText.trim() || !draft.correctIdea.trim()}
              loading={saving || loadingDetail}
              loadingLabel={isEditing ? "保存修改中..." : "保存中..."}
              leftIcon={<BookOpenCheck className="size-4" aria-hidden="true" />}
            >
              {isEditing ? "保存修改并同步本次学习" : "保存错题并关联本次学习"}
            </Button>
          </div>
        </div>

        {error ? <Alert tone="danger">{error}</Alert> : null}
      </form>
    </div>
  );
}
