"use client";

import { BookOpenCheck, Bug, FileText } from "lucide-react";
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
import type { FocusEvidenceType } from "@/components/focus-session-panels";
import type { MistakeCauseDto, NoteMasteryStatusDto } from "@/lib/contracts";
import { createNote } from "@/lib/api/notes";
import { createMistake } from "@/lib/api/mistakes";
import { isShanghaiDateInputError, shanghaiDateTimeInputToIso } from "@/lib/formatters";

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
  onEvidenceSaved: (input: { evidenceType: FocusEvidenceType; evidenceId: string; label: string }) => Promise<void>;
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
  onEvidenceSaved: (input: { evidenceType: FocusEvidenceType; evidenceId: string; label: string }) => Promise<void>;
}) {
  const draftKey = `areaforge.focus.evidence.note.${props.userId}.${props.sessionId}`;
  const commandScope = `focus-note:${props.sessionId}`;
  const [draft, setDraft] = useState<NoteDraft>(emptyNoteDraft);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEvidenceDraft(draftKey, draft, setDraft, hydrated, setHydrated, isNoteDraft, emptyNoteDraft);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
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
    } catch (caught) {
      setError(isShanghaiDateInputError(caught)
        ? "下次复习时间无效，知识卡片草稿与重试身份已保留。"
        : evidenceErrorMessage(caught, "保存知识卡片失败，草稿与重试身份已保留。"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <EvidenceHeading icon={<FileText />} title="创建知识卡片" context={contextLabel(props)} />
      <form noValidate className="mt-6 grid gap-4" onSubmit={submit}>
        <div className="af-content-grid-two grid gap-3">
          <Field label="卡片类型" htmlFor="focus-note-kind"><Select id="focus-note-kind" className={inputClass} value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as NoteDraft["kind"] })}><option value="GENERAL">通用</option><option value="CONCEPT">概念</option><option value="METHOD">方法</option><option value="EXAMPLE">例题</option><option value="JOURNAL">学习记录</option><option value="SUMMARY">总结</option></Select></Field>
          <Field label="掌握状态" htmlFor="focus-note-mastery-status"><Select id="focus-note-mastery-status" className={inputClass} value={draft.masteryStatus} onChange={(event) => setDraft({ ...draft, masteryStatus: event.target.value as NoteMasteryStatusDto })}><option value="understood">理解了</option><option value="partial">似懂非懂</option><option value="unknown">不会</option><option value="relearn">需要重学</option><option value="before_exam">考前再看</option></Select></Field>
        </div>
        <Field label="标题" htmlFor="focus-note-title"><Input id="focus-note-title" required maxLength={160} className={inputClass} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="这张卡片解决什么问题" /></Field>
        <Field label="自己的解释" htmlFor="focus-note-content"><Textarea id="focus-note-content" required maxLength={10000} className={`${inputClass} min-h-40 py-3`} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="写下自己的理解、方法或推导" /></Field>
        <Field label="下次复习时间（可选）" htmlFor="focus-note-next-review"><Input id="focus-note-next-review" type="datetime-local" className={inputClass} value={draft.nextReviewAt} onChange={(event) => setDraft({ ...draft, nextReviewAt: event.target.value })} /></Field>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Button type="submit" variant="primary" size="lg" loading={saving} loadingLabel="保存并回写中" disabled={!draft.title.trim() || !draft.content.trim()}><BookOpenCheck className="h-4 w-4" aria-hidden="true" />保存卡片并关联本次学习</Button>
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
  onEvidenceSaved: (input: { evidenceType: FocusEvidenceType; evidenceId: string; label: string }) => Promise<void>;
}) {
  const draftKey = `areaforge.focus.evidence.mistake.${props.userId}.${props.sessionId}`;
  const commandScope = `focus-mistake:${props.sessionId}`;
  const [draft, setDraft] = useState<MistakeDraft>(emptyMistakeDraft);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEvidenceDraft(draftKey, draft, setDraft, hydrated, setHydrated, isMistakeDraft, emptyMistakeDraft);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
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
    } catch (caught) {
      setError(isShanghaiDateInputError(caught)
        ? "下次复习时间无效，错题草稿与重试身份已保留。"
        : evidenceErrorMessage(caught, "保存错题失败，草稿与重试身份已保留。"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <EvidenceHeading icon={<Bug />} title="记录错题" context={contextLabel(props)} />
      <form noValidate className="mt-6 grid gap-4" onSubmit={submit}>
        <Field label="错题标题" htmlFor="focus-mistake-title"><Input id="focus-mistake-title" required maxLength={180} className={inputClass} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="哪一步或哪类题出了问题" /></Field>
        <Field label="题目正文" htmlFor="focus-mistake-question"><Textarea id="focus-mistake-question" required maxLength={10000} className={`${inputClass} min-h-36 py-3`} value={draft.questionText} onChange={(event) => setDraft({ ...draft, questionText: event.target.value })} placeholder="记录完整题面、条件和问题" /></Field>
        <div className="af-content-grid-two grid gap-3">
          <Field label="错因" htmlFor="focus-mistake-cause"><Select id="focus-mistake-cause" className={inputClass} value={draft.cause} onChange={(event) => setDraft({ ...draft, cause: event.target.value as MistakeDraft["cause"] })}><option value="concept_confusion">概念混淆</option><option value="formula_unfamiliar">公式不熟</option><option value="wrong_approach">思路错误</option><option value="careless">粗心</option><option value="time_pressure">时间压力</option><option value="unfamiliar_pattern">题型陌生</option></Select></Field>
          <Field label="来源（可选）" htmlFor="focus-mistake-source"><Input id="focus-mistake-source" maxLength={500} className={inputClass} value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })} placeholder="教材、题号或试卷" /></Field>
        </div>
        <Field label="错因补充" htmlFor="focus-mistake-cause-note"><Textarea id="focus-mistake-cause-note" maxLength={2000} className={`${inputClass} min-h-24 py-3`} value={draft.causeNote} onChange={(event) => setDraft({ ...draft, causeNote: event.target.value })} placeholder="具体错在哪一步" /></Field>
        <Field label="标准答案（可选）" htmlFor="focus-mistake-correct-answer"><Textarea id="focus-mistake-correct-answer" maxLength={5000} className={`${inputClass} min-h-24 py-3`} value={draft.correctAnswer} onChange={(event) => setDraft({ ...draft, correctAnswer: event.target.value })} placeholder="没有唯一答案时可留空" /></Field>
        <Field label="正确思路" htmlFor="focus-mistake-correct-idea"><Textarea id="focus-mistake-correct-idea" required maxLength={3000} className={`${inputClass} min-h-36 py-3`} value={draft.correctIdea} onChange={(event) => setDraft({ ...draft, correctIdea: event.target.value })} placeholder="写清错误发生在哪里，以及下一次如何识别" /></Field>
        <Field label="下次复习时间（可选）" htmlFor="focus-mistake-next-review"><Input id="focus-mistake-next-review" type="datetime-local" className={inputClass} value={draft.nextReviewAt} onChange={(event) => setDraft({ ...draft, nextReviewAt: event.target.value })} /></Field>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Button type="submit" variant="primary" size="lg" loading={saving} loadingLabel="保存并回写中" disabled={!draft.title.trim() || !draft.questionText.trim() || !draft.correctIdea.trim()}><BookOpenCheck className="h-4 w-4" aria-hidden="true" />保存错题并关联本次学习</Button>
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
) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = loadPrivateBusinessDraft(key, LONG_PRIVATE_DRAFT_TTL_MS, validator);
      if (saved) setValue(saved);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [key, setHydrated, setValue, validator]);
  useEffect(() => {
    if (!hydrated) return;
    if (JSON.stringify(value) === JSON.stringify(emptyValue)) removePrivateBusinessDraft(key);
    else savePrivateBusinessDraft(key, value);
  }, [emptyValue, hydrated, key, value]);
}

function EvidenceHeading(props: { icon: React.ReactNode; title: string; context: string | null }) {
  return <div><span className="text-teal-300 [&>svg]:h-5 [&>svg]:w-5" aria-hidden="true">{props.icon}</span><h2 className="mt-3 text-xl font-semibold text-white">{props.title}</h2>{props.context ? <p className="mt-2 text-sm text-zinc-500">自动关联：{props.context}</p> : null}</div>;
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

const inputClass = "h-11 w-full rounded-md border border-white/10 bg-[var(--af-surface-raised)] px-3 text-sm text-white placeholder:text-zinc-600";
