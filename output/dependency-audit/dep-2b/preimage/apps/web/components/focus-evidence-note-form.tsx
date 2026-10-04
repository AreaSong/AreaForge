"use client";

import type React from "react";
import { useEffect, useState } from "react";
import { BookOpenCheck, FileText, Trash2, X } from "lucide-react";
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
import type { NoteMasteryStatusDto } from "@/lib/contracts";
import { createNote, getNote, updateNote } from "@/lib/api/notes";
import {
  isShanghaiDateInputError,
  isoToShanghaiDateTimeInput,
  shanghaiDateTimeInputToIso,
} from "@/lib/formatters";
import {
  type EvidenceContext,
  EvidenceHeading,
  type NoteDraft,
  emptyNoteDraft,
  isNoteDraft,
  useEvidenceDraft,
  contextLabel,
  evidenceErrorMessage,
  inputClass,
} from "./focus-evidence-form-helpers";

export function FocusNoteForm(props: EvidenceContext & {
  editingReceipt?: FocusEvidenceReceipt | null;
  onCancelEdit?: () => void;
  onDeleteReceipt?: (receipt: FocusEvidenceReceipt) => void;
  onEvidenceSaved: (input: { evidenceType: FocusEvidenceType; evidenceId: string; label: string }) => Promise<void>;
  onEvidenceUpdated?: (receipt: FocusEvidenceReceipt) => Promise<void> | void;
}) {
  const isEditing = Boolean(props.editingReceipt && props.editingReceipt.evidenceType === "note");
  const draftKey = `areaforge.focus.evidence.note.${props.userId}.${props.sessionId}`;
  const commandScope = `focus-note:${props.sessionId}`;
  const [draft, setDraft] = useState<NoteDraft>(emptyNoteDraft);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [editingRevision, setEditingRevision] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEvidenceDraft(draftKey, draft, setDraft, hydrated, setHydrated, isNoteDraft, emptyNoteDraft, isEditing);

  useEffect(() => {
    if (!isEditing || !props.editingReceipt) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoadingDetail(true);
      setError(null);
      const res = await getNote(props.editingReceipt!.evidenceId);
      if (!active) return;
      setLoadingDetail(false);
      if (res.ok && res.body?.note) {
        const note = res.body.note;
        setDraft({
          title: note.title,
          content: note.content,
          kind: (note.kind as NoteDraft["kind"]) || "GENERAL",
          masteryStatus: note.masteryStatus || "partial",
          nextReviewAt: note.nextReviewAt ? isoToShanghaiDateTimeInput(note.nextReviewAt) : "",
        });
        setEditingRevision(note.revision || 1);
      } else {
        setError("获取知识卡片详情失败，请重试。");
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
        taskId: props.taskId,
        kind: draft.kind,
        title: draft.title.trim(),
        content: draft.content.trim(),
        masteryStatus: draft.masteryStatus,
        nextReviewAt: draft.nextReviewAt ? shanghaiDateTimeInputToIso(draft.nextReviewAt) : null,
      };

      if (isEditing && props.editingReceipt) {
        const result = await updateNote(props.editingReceipt.evidenceId, {
          expectedRevision: editingRevision,
          ...payload,
        });
        if (!result.ok || !result.body?.note) {
          const failure = classifyApiFailure(result);
          throw new Error(
            failure.code
            ?? Object.values(failure.fieldErrors).flat()[0]
            ?? "更新知识卡片失败。",
          );
        }
        await props.onEvidenceUpdated?.({
          evidenceType: "note",
          evidenceId: props.editingReceipt.evidenceId,
          label: result.body.note.title,
        });
        setDraft(emptyNoteDraft);
      } else {
        const result = await createNote({
          idempotencyKey: getOrCreateIdempotencyKey(commandScope, "focus-note", payload),
          ...payload,
        });
        if (!result.ok) {
          const failure = classifyApiFailure(result);
          if (failure.kind === "unauthorized") {
            redirectToLoginWithCurrentLocation();
            throw new Error("登录已过期，卡片草稿与重试身份已保留。重新登录后请显式重试。");
          }
          throw new Error(
            failure.code
            ?? Object.values(failure.fieldErrors).flat()[0]
            ?? "保存知识卡片失败，草稿已保留。",
          );
        }
        if (!result.body?.note) throw new Error("保存知识卡片失败，草稿已保留。");
        await props.onEvidenceSaved({ evidenceType: "note", evidenceId: result.body.note.id, label: result.body.note.title });
        completeIdempotentCommand(commandScope);
        removePrivateBusinessDraft(draftKey);
        setDraft(emptyNoteDraft);
      }
    } catch (caught) {
      setError(isShanghaiDateInputError(caught)
        ? "下次复习时间无效，知识卡片草稿与重试身份已保留。"
        : evidenceErrorMessage(caught, isEditing ? "更新知识卡片失败，请重试。" : "保存知识卡片失败，草稿与重试身份已保留。"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <EvidenceHeading
        icon={<FileText />}
        title={isEditing ? `修改知识卡片 · ${props.editingReceipt?.label || ""}` : "创建知识卡片"}
        context={contextLabel(props)}
      />
      <form noValidate className="space-y-3.5" onSubmit={submit}>
        {/* Card 1: Meta & Title */}
        <div className="rounded-2xl border border-white/10 bg-[#0e1619]/90 p-4 sm:p-5 shadow-lg space-y-3.5">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="卡片类型" htmlFor="focus-note-kind">
              <Select
                id="focus-note-kind"
                className={inputClass}
                value={draft.kind}
                onChange={(event) => setDraft({ ...draft, kind: event.target.value as NoteDraft["kind"] })}
                disabled={loadingDetail}
              >
                <option value="GENERAL">通用</option>
                <option value="CONCEPT">概念</option>
                <option value="METHOD">方法</option>
                <option value="EXAMPLE">例题</option>
                <option value="JOURNAL">学习记录</option>
                <option value="SUMMARY">总结</option>
              </Select>
            </Field>

            <Field label="掌握状态" htmlFor="focus-note-mastery-status">
              <Select
                id="focus-note-mastery-status"
                className={inputClass}
                value={draft.masteryStatus}
                onChange={(event) => setDraft({ ...draft, masteryStatus: event.target.value as NoteMasteryStatusDto })}
                disabled={loadingDetail}
              >
                <option value="understood">理解了</option>
                <option value="partial">似懂非懂</option>
                <option value="unknown">不会</option>
                <option value="relearn">需要重学</option>
                <option value="before_exam">考前再看</option>
              </Select>
            </Field>
          </div>

          <Field label="卡片标题" htmlFor="focus-note-title">
            <Input
              id="focus-note-title"
              required
              maxLength={160}
              className={inputClass}
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="例如：极值定理的核心判别步骤"
              disabled={loadingDetail}
            />
          </Field>
        </div>

        {/* Card 2: Content Textarea */}
        <div className="rounded-2xl border border-white/10 bg-[#0e1619]/90 p-4 sm:p-5 shadow-lg">
          <Field label="自己的解释与推导" htmlFor="focus-note-content">
            <Textarea
              id="focus-note-content"
              required
              maxLength={10000}
              className={`${inputClass} min-h-32 sm:min-h-36 py-3 resize-none leading-relaxed`}
              value={draft.content}
              onChange={(event) => setDraft({ ...draft, content: event.target.value })}
              placeholder="写下自己的理解、核心方法、反思或推导关键..."
              disabled={loadingDetail}
            />
          </Field>
        </div>

        {/* Card 3: Next Review & Submit */}
        <div className="rounded-2xl border border-white/10 bg-[#0e1619]/90 p-4 sm:p-5 shadow-lg flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="flex-1">
            <Field label="下次复习时间（可选）" htmlFor="focus-note-next-review">
              <Input
                id="focus-note-next-review"
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
                  setDraft(emptyNoteDraft);
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
              disabled={saving || loadingDetail || !draft.title.trim() || !draft.content.trim()}
              loading={saving || loadingDetail}
              loadingLabel={isEditing ? "保存修改中..." : "保存中..."}
              leftIcon={<BookOpenCheck className="size-4" aria-hidden="true" />}
            >
              {isEditing ? "保存修改并同步本次学习" : "保存卡片并关联本次学习"}
            </Button>
          </div>
        </div>

        {error ? <Alert tone="danger">{error}</Alert> : null}
      </form>
    </div>
  );
}
