"use client";

import { BookOpenCheck, Bug, FileText, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { SyllabusRetestForm } from "@/components/syllabus-retest-form";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/feedback";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import {
  LONG_PRIVATE_DRAFT_TTL_MS,
  loadPrivateBusinessDraft,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import { classifyApiFailure } from "@/lib/client/api-errors";
import type { FocusEvidenceReceipt, FocusEvidenceType } from "@/components/focus-session-evidence";
import type { MistakeCauseDto, NoteMasteryStatusDto } from "@/lib/contracts";
import { createNote, getNote, updateNote } from "@/lib/api/notes";
import { createMistake, getMistake, updateMistake } from "@/lib/api/mistakes";
import { isShanghaiDateInputError, isoToShanghaiDateTimeInput, shanghaiDateTimeInputToIso } from "@/lib/formatters";

interface EvidenceContext {
  userId: string;
  sessionId: string;
  subjectId: string;
  subjectName: string;
  taskId: string | null;
  taskTitle: string | null;
  syllabusNodeId: string | null;
  syllabusNodeTitle: string | null;
}

export function FocusEvidenceForms(props: EvidenceContext & {
  activeType: FocusEvidenceType;
  editingReceipt?: FocusEvidenceReceipt | null;
  onCancelEdit?: () => void;
  onDeleteReceipt?: (receipt: FocusEvidenceReceipt) => void;
  onEvidenceSaved: (input: { evidenceType: FocusEvidenceType; evidenceId: string; label: string }) => Promise<void>;
  onEvidenceUpdated?: (receipt: FocusEvidenceReceipt) => Promise<void> | void;
}) {
  if (props.activeType === "note") return <FocusNoteForm {...props} />;
  if (props.activeType === "mistake") return <FocusMistakeForm {...props} />;
  if (!props.syllabusNodeId) return <Alert tone="warning">本次学习没有关联考纲节点，无法记录复测。</Alert>;
  return (
    <div>
      <EvidenceHeading icon={<BookOpenCheck />} title="记录复测" context={props.syllabusNodeTitle} />
      <SyllabusRetestForm
        compact
        nodeId={props.syllabusNodeId}
        draftScope={`${props.syllabusNodeId}.focus.${props.sessionId}`}
        commandScope={`mastery-retest:${props.syllabusNodeId}:focus:${props.sessionId}`}
        onCancel={() => undefined}
        onSaved={async ({ retestId }) => {
          if (!retestId) throw new Error("复测已经保存，但服务端没有返回回写标识；请保留当前页面并显式重试。");
          await props.onEvidenceSaved({ evidenceType: "retest", evidenceId: retestId, label: "复测记录" });
        }}
      />
    </div>
  );
}

interface NoteDraft {
  title: string;
  content: string;
  kind: "GENERAL" | "CONCEPT" | "METHOD" | "EXAMPLE" | "JOURNAL" | "SUMMARY";
  masteryStatus: NoteMasteryStatusDto;
  nextReviewAt: string;
}

const emptyNoteDraft: NoteDraft = { title: "", content: "", kind: "GENERAL", masteryStatus: "partial", nextReviewAt: "" };

function FocusNoteForm(props: EvidenceContext & {
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
    setLoadingDetail(true);
    setError(null);
    void getNote(props.editingReceipt.evidenceId).then((res) => {
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
    return () => { active = false; };
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

interface MistakeDraft {
  title: string;
  questionText: string;
  source: string;
  cause: Exclude<MistakeCauseDto, "unknown">;
  causeNote: string;
  correctAnswer: string;
  correctIdea: string;
  nextReviewAt: string;
}

const emptyMistakeDraft: MistakeDraft = { title: "", questionText: "", source: "", cause: "concept_confusion", causeNote: "", correctAnswer: "", correctIdea: "", nextReviewAt: "" };

function FocusMistakeForm(props: EvidenceContext & {
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
    setLoadingDetail(true);
    setError(null);
    void getMistake(props.editingReceipt.evidenceId).then((res) => {
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
    return () => { active = false; };
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

function useEvidenceDraft<T>(
  key: string,
  value: T,
  setValue: (value: T) => void,
  hydrated: boolean,
  setHydrated: (value: boolean) => void,
  validator: (value: unknown) => value is T,
  emptyValue: T,
  disabled: boolean = false,
) {
  useEffect(() => {
    if (disabled) return;
    const timer = window.setTimeout(() => {
      const saved = loadPrivateBusinessDraft(key, LONG_PRIVATE_DRAFT_TTL_MS, validator);
      if (saved) setValue(saved);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [disabled, key, setHydrated, setValue, validator]);
  useEffect(() => {
    if (disabled || !hydrated) return;
    if (JSON.stringify(value) === JSON.stringify(emptyValue)) removePrivateBusinessDraft(key);
    else savePrivateBusinessDraft(key, value);
  }, [disabled, emptyValue, hydrated, key, value]);
}

function EvidenceHeading(props: { icon: React.ReactNode; title: string; context: string | null }) {
  return (
    <div className="flex items-center justify-between border-b border-white/10 pb-3.5">
      <div>
        <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-teal-300">认知沉淀</p>
        <h2 className="mt-0.5 text-lg sm:text-xl font-bold tracking-tight text-white flex items-center gap-2">
          {props.title}
        </h2>
        {props.context ? <p className="mt-0.5 text-[11px] sm:text-xs text-zinc-400">自动关联：{props.context}</p> : null}
      </div>
    </div>
  );
}

function contextLabel(props: EvidenceContext) {
  return [props.subjectName, props.taskTitle, props.syllabusNodeTitle].filter(Boolean).join(" / ");
}

function evidenceErrorMessage(error: unknown, fallback: string) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return "网络不可用，草稿与重试身份已保留。恢复网络后请显式重试。";
  return error instanceof Error ? error.message : fallback;
}

function isNoteDraft(value: unknown): value is NoteDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Partial<NoteDraft>;
  return typeof draft.title === "string" && typeof draft.content === "string" && typeof draft.nextReviewAt === "string" && ["GENERAL", "CONCEPT", "METHOD", "EXAMPLE", "JOURNAL", "SUMMARY"].includes(draft.kind ?? "") && ["understood", "partial", "unknown", "relearn", "before_exam"].includes(draft.masteryStatus ?? "");
}

function isMistakeDraft(value: unknown): value is MistakeDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Partial<MistakeDraft>;
  return [draft.title, draft.questionText, draft.source, draft.causeNote, draft.correctAnswer, draft.correctIdea, draft.nextReviewAt].every((field) => typeof field === "string") && ["concept_confusion", "formula_unfamiliar", "wrong_approach", "careless", "time_pressure", "unfamiliar_pattern"].includes(draft.cause ?? "");
}

const inputClass = "h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-xs sm:text-sm text-white placeholder:text-zinc-600 focus:border-teal-400 focus:outline-none transition-colors";
