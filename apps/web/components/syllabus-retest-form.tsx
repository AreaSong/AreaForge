"use client";

import { RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import {
  LONG_PRIVATE_DRAFT_TTL_MS,
  loadPrivateBusinessDraft,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";

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
    const payload = {
      testedAt: draft.testedAt ? localDateTimeToIso(draft.testedAt) : undefined,
      result: draft.result,
      score: draft.score.trim() || undefined,
      summary: draft.summary.trim() || undefined,
      nextReviewAt: draft.nextReviewDate ? dateToIso(draft.nextReviewDate) : null,
    };
    try {
      const response = await fetch(`/api/syllabus/nodes/${props.nodeId}/mastery-retests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: getOrCreateIdempotencyKey(commandScope, "mastery-retest", payload),
          ...payload,
        }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string; retestId?: string } | null;
      if (response.status === 401) {
        savePrivateBusinessDraft(draftKey, draft);
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        setError(body?.error ?? "复测记录保存失败，输入和重试身份仍保留");
        return;
      }
      await props.onSaved({ retestId: body?.retestId });
      completeIdempotentCommand(commandScope);
      removePrivateBusinessDraft(draftKey);
    } catch (caught) {
      savePrivateBusinessDraft(draftKey, draft);
      setError(caught instanceof Error ? caught.message : "网络中断，输入与同一重试身份已保留；恢复网络后请显式重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={props.compact ? "space-y-4" : "space-y-4 border-y border-white/10 py-5"} onSubmit={submit}>
      {!props.compact ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">记录复测</h2>
          <button type="button" className="inline-flex h-10 items-center gap-2 px-2 text-sm text-zinc-300" onClick={props.onCancel}>
            <X className="h-4 w-4" aria-hidden="true" />关闭复测
          </button>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm text-zinc-300">
          结果
          <select className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white" value={draft.result} onChange={(event) => setDraft((current) => ({ ...current, result: event.target.value as RetestDraft["result"] }))}>
            <option value="passed">通过</option><option value="partial">部分通过</option><option value="failed">未通过</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm text-zinc-300">
          复测时间（可选）
          <input className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white" type="datetime-local" value={draft.testedAt} onChange={(event) => setDraft((current) => ({ ...current, testedAt: event.target.value }))} />
        </label>
        <label className="grid gap-2 text-sm text-zinc-300">
          得分（可选）
          <input className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white" value={draft.score} maxLength={80} onChange={(event) => setDraft((current) => ({ ...current, score: event.target.value }))} />
        </label>
        <label className="grid gap-2 text-sm text-zinc-300">
          下次复习日期（可选）
          <input className="h-11 rounded-md border border-white/10 bg-[#0d1117] px-3 text-white" type="date" value={draft.nextReviewDate} onChange={(event) => setDraft((current) => ({ ...current, nextReviewDate: event.target.value }))} />
        </label>
      </div>
      <label className="grid gap-2 text-sm text-zinc-300">
        复测摘要
        <textarea className="min-h-28 rounded-md border border-white/10 bg-[#0d1117] p-3 text-white" value={draft.summary} maxLength={2000} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} />
      </label>
      {error ? <p role="alert" className="text-sm text-red-200">{error}</p> : null}
      <button type="submit" className="inline-flex h-11 items-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:opacity-50" disabled={saving}>
        <RotateCcw className="h-4 w-4" aria-hidden="true" />{saving ? "保存中" : "保存复测"}
      </button>
    </form>
  );
}

function isRetestDraft(value: unknown): value is RetestDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Partial<RetestDraft>;
  return ["passed", "partial", "failed"].includes(draft.result ?? "") && typeof draft.testedAt === "string" && typeof draft.score === "string" && typeof draft.summary === "string" && typeof draft.nextReviewDate === "string";
}

function localDateTimeToIso(value: string): string { return new Date(`${value}:00+08:00`).toISOString(); }
function dateToIso(value: string): string { return new Date(`${value}T00:00:00+08:00`).toISOString(); }
