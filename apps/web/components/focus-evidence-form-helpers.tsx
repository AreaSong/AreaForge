"use client";

import type React from "react";
import { useEffect } from "react";
import {
  LONG_PRIVATE_DRAFT_TTL_MS,
  loadPrivateBusinessDraft,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { MistakeCauseDto, NoteMasteryStatusDto } from "@/lib/contracts";

export interface EvidenceContext {
  userId: string;
  sessionId: string;
  subjectId: string;
  subjectName: string;
  taskId: string | null;
  taskTitle: string | null;
  syllabusNodeId: string | null;
  syllabusNodeTitle: string | null;
}

export interface NoteDraft {
  title: string;
  content: string;
  kind: "GENERAL" | "CONCEPT" | "METHOD" | "EXAMPLE" | "JOURNAL" | "SUMMARY";
  masteryStatus: NoteMasteryStatusDto;
  nextReviewAt: string;
}

export const emptyNoteDraft: NoteDraft = {
  title: "",
  content: "",
  kind: "GENERAL",
  masteryStatus: "partial",
  nextReviewAt: "",
};

export interface MistakeDraft {
  title: string;
  questionText: string;
  source: string;
  cause: Exclude<MistakeCauseDto, "unknown">;
  causeNote: string;
  correctAnswer: string;
  correctIdea: string;
  nextReviewAt: string;
}

export const emptyMistakeDraft: MistakeDraft = {
  title: "",
  questionText: "",
  source: "",
  cause: "concept_confusion",
  causeNote: "",
  correctAnswer: "",
  correctIdea: "",
  nextReviewAt: "",
};

export function useEvidenceDraft<T>(
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

export function EvidenceHeading(props: { icon: React.ReactNode; title: string; context: string | null }) {
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

export function contextLabel(props: EvidenceContext) {
  return [props.subjectName, props.taskTitle, props.syllabusNodeTitle].filter(Boolean).join(" / ");
}

export function evidenceErrorMessage(error: unknown, fallback: string) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return "网络不可用，草稿与重试身份已保留。恢复网络后请显式重试。";
  return error instanceof Error ? error.message : fallback;
}

export function isNoteDraft(value: unknown): value is NoteDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Partial<NoteDraft>;
  return (
    typeof draft.title === "string" &&
    typeof draft.content === "string" &&
    typeof draft.nextReviewAt === "string" &&
    ["GENERAL", "CONCEPT", "METHOD", "EXAMPLE", "JOURNAL", "SUMMARY"].includes(draft.kind ?? "") &&
    ["understood", "partial", "unknown", "relearn", "before_exam"].includes(draft.masteryStatus ?? "")
  );
}

export function isMistakeDraft(value: unknown): value is MistakeDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Partial<MistakeDraft>;
  return (
    [draft.title, draft.questionText, draft.source, draft.causeNote, draft.correctAnswer, draft.correctIdea, draft.nextReviewAt].every(
      (field) => typeof field === "string",
    ) &&
    ["concept_confusion", "formula_unfamiliar", "wrong_approach", "careless", "time_pressure", "unfamiliar_pattern"].includes(
      draft.cause ?? "",
    )
  );
}

export const inputClass =
  "h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-xs sm:text-sm text-white placeholder:text-zinc-600 focus:border-teal-400 focus:outline-none transition-colors";
