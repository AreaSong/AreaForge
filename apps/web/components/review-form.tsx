"use client";

import { NotebookPen } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import {
  loadPrivateBusinessDraft,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
  SHORT_PRIVATE_DRAFT_TTL_MS,
} from "@/lib/client/private-business-drafts";
import type { DailyReviewDto } from "@/lib/study/types";

interface ReviewFormProps {
  userId: string;
  workspaceId: string;
  studyDayKey: string;
  review: DailyReviewDto | null;
}

interface ReviewFields {
  summary: string;
  lostControl: string;
  keepAction: string;
  tomorrowMinimum: string;
  mood: string;
}

interface ReviewDraft {
  workspaceId: string;
  studyDayKey: string;
  baseReviewId: string | null;
  baseRevision: number | null;
  baselineFields: ReviewFields;
  fields: ReviewFields;
}

interface ReviewConflict {
  submitted: ReviewDraft;
  latest: DailyReviewDto;
  conflictFields: string[];
}

const moodOptions = ["焦虑", "麻木", "想她", "自责", "有斗志", "很累", "平静", "失控"] as const;

export function ReviewForm({ userId, workspaceId, studyDayKey, review }: ReviewFormProps) {
  const router = useRouter();
  const draftKey = `areaforge.daily-review.draft.${userId}.${workspaceId}.${studyDayKey}`;
  const [baseline, setBaseline] = useState(review);
  const [fields, setFields] = useState<ReviewFields>(() => fieldsFromReview(review));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [conflict, setConflict] = useState<ReviewConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const currentMood = fields.mood;
  const hasLegacyMood = currentMood.length > 0 && !moodOptions.includes(currentMood as (typeof moodOptions)[number]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft = loadPrivateBusinessDraft(draftKey, SHORT_PRIVATE_DRAFT_TTL_MS, isReviewDraft);
      if (draft?.workspaceId === workspaceId && draft.studyDayKey === studyDayKey) {
        setFields(draft.fields);
        if (baseline && (draft.baseReviewId !== baseline.id || draft.baseRevision !== baseline.revision)) {
          setConflict({ submitted: draft, latest: baseline, conflictFields: ["revision"] });
          setConflictOpen(true);
        }
      }
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [baseline, draftKey, studyDayKey, workspaceId]);

  useEffect(() => {
    if (!draftReady) return;
    const baselineFields = fieldsFromReview(baseline);
    if (reviewFieldsEqual(fields, baselineFields)) {
      removePrivateBusinessDraft(draftKey);
      return;
    }
    savePrivateBusinessDraft<ReviewDraft>(draftKey, {
      workspaceId,
      studyDayKey,
      baseReviewId: baseline?.id ?? null,
      baseRevision: baseline?.revision ?? null,
      baselineFields,
      fields,
    });
  }, [baseline, draftKey, draftReady, fields, studyDayKey, workspaceId]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || conflict) return;
    setError(null);
    setSaved(false);
    setSaving(true);
    const submission: ReviewDraft = {
      workspaceId,
      studyDayKey,
      baseReviewId: baseline?.id ?? null,
      baseRevision: baseline?.revision ?? null,
      baselineFields: fieldsFromReview(baseline),
      fields: structuredClone(fields),
    };
    savePrivateBusinessDraft(draftKey, submission);
    const commandScope = reviewCommandScope(userId, workspaceId, studyDayKey, baseline);
    const payload = {
      ...(baseline ? { expectedRevision: baseline.revision } : {}),
      ...submission.fields,
    };

    try {
      const response = await fetch(baseline ? `/api/daily-reviews/${baseline.id}` : "/api/daily-reviews", {
        method: baseline ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          idempotencyKey: getOrCreateIdempotencyKey(commandScope, "daily-review", payload),
        }),
      });
      const body = (await response.json().catch(() => null)) as ReviewResponseBody | null;

      if (response.status === 401) {
        setError("登录已过期，复盘草稿已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (response.status === 404) {
        completeIdempotentCommand(commandScope);
        setError("这份复盘已不可用，草稿仍保留；正在返回复盘工作台。");
        router.replace("/review/daily");
        return;
      }
      if (response.status === 409 && isDailyReviewDto(body?.latest)) {
        completeIdempotentCommand(commandScope);
        setConflict({
          submitted: submission,
          latest: body.latest,
          conflictFields: body.conflictFields ?? ["revision"],
        });
        setConflictOpen(true);
        setError(body.error ?? "服务端复盘已变化，本地输入仍保留。");
        return;
      }
      if (!response.ok) {
        setError(body?.error ?? "保存复盘失败，草稿与重试标识仍保留");
        return;
      }
      if (!isDailyReviewDto(body?.review)) {
        setError("服务端未返回已保存复盘，当前输入与重试标识仍保留");
        return;
      }

      completeIdempotentCommand(commandScope);
      setBaseline(body.review);
      setFields(fieldsFromReview(body.review));
      removePrivateBusinessDraft(draftKey);
      setSaved(true);
      startTransition(() => router.refresh());
    } catch {
      setError("网络不可用，复盘草稿与命令身份已保留；恢复网络后请显式重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <div className="rounded-lg border border-white/10 bg-[#101419] p-5">
      <div className="flex items-center gap-2">
        <NotebookPen className="h-5 w-5 text-teal-300" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-white">晚间复盘</h2>
      </div>
      <form onSubmit={submit} className="mt-4 grid gap-3">
        <textarea
          className="min-h-20 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm text-zinc-100"
          name="summary"
          placeholder="今天完成了什么"
          value={fields.summary}
          onChange={(event) => setFields((current) => ({ ...current, summary: event.target.value }))}
          required
        />
        <textarea
          className="min-h-16 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm text-zinc-100"
          name="lostControl"
          placeholder="今天哪里失控了"
          value={fields.lostControl}
          onChange={(event) => setFields((current) => ({ ...current, lostControl: event.target.value }))}
        />
        <input
          className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
          name="keepAction"
          placeholder="今天最该保留的一个动作"
          value={fields.keepAction}
          onChange={(event) => setFields((current) => ({ ...current, keepAction: event.target.value }))}
          required
        />
        <input
          className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
          name="tomorrowMinimum"
          placeholder="明天最小必须完成任务"
          value={fields.tomorrowMinimum}
          onChange={(event) => setFields((current) => ({ ...current, tomorrowMinimum: event.target.value }))}
          required
        />
        <select
          className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
          name="mood"
          value={fields.mood}
          onChange={(event) => setFields((current) => ({ ...current, mood: event.target.value }))}
          aria-label="情绪状态"
        >
          <option value="">不记录情绪状态</option>
          {hasLegacyMood ? <option value={currentMood}>当前记录：{currentMood}</option> : null}
          {moodOptions.map((mood) => (
            <option key={mood} value={mood}>
              {mood}
            </option>
          ))}
        </select>
        <button
          className="h-11 rounded-md bg-teal-400 px-4 font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-50"
          type="submit"
          disabled={isPending || saving || conflict !== null}
        >
          {saving ? "保存中..." : baseline ? "更新复盘" : "保存复盘"}
        </button>
      </form>
      {baseline ? (
        <p className="mt-3 text-sm text-zinc-400">
          已记录 {baseline.totalMinutes} 分钟学习，其中有效 {baseline.effectiveMinutes} 分钟。
        </p>
      ) : null}
      <div aria-live="polite">
        {saved ? (
          <p className="mt-3 text-sm text-emerald-200">
            复盘与明日最低行动已保存。<Link className="ml-2 underline" href="/today/inbox">查看收件箱</Link>
          </p>
        ) : null}
        {error ? <p role="alert" className="mt-3 text-sm text-red-200">{error}</p> : null}
      </div>
      {conflict && !conflictOpen ? (
        <button type="button" className="mt-3 text-sm text-amber-200 underline" onClick={() => setConflictOpen(true)}>
          处理复盘版本冲突
        </button>
      ) : null}
    </div>
    <ConflictResolutionModal
      open={conflictOpen && conflict !== null}
      title="复盘已在其他页面更新"
      description="本地草稿、首次提交基线和服务端最新值均已保留。系统不会强制覆盖或自动重放。"
      conflictFields={conflict?.conflictFields ?? []}
      comparisons={conflict ? reviewConflictComparisons(conflict) : []}
      onClose={() => setConflictOpen(false)}
      onAdoptServer={() => {
        if (!conflict) return;
        setBaseline(conflict.latest);
        setFields(fieldsFromReview(conflict.latest));
        removePrivateBusinessDraft(draftKey);
        setConflict(null);
        setConflictOpen(false);
        setError("已采用服务端最新复盘；没有自动执行任何写入。");
      }}
      onManualMerge={() => {
        if (!conflict) return;
        setBaseline(conflict.latest);
        setConflict(null);
        setConflictOpen(false);
        setError("本地输入已保留并改用服务端最新 revision；请检查合并后显式再次保存。");
      }}
    />
    </>
  );
}

interface ReviewResponseBody {
  review?: unknown;
  error?: string;
  latest?: unknown;
  conflictFields?: string[];
  workbench?: string;
}

function fieldsFromReview(review: DailyReviewDto | null): ReviewFields {
  return {
    summary: review?.summary ?? "",
    lostControl: review?.lostControl ?? "",
    keepAction: review?.keepAction ?? "",
    tomorrowMinimum: review?.tomorrowMinimum ?? "",
    mood: review?.mood ?? "",
  };
}

function reviewCommandScope(
  userId: string,
  workspaceId: string,
  studyDayKey: string,
  review: DailyReviewDto | null,
): string {
  return `daily-review:${userId}:${workspaceId}:${studyDayKey}:${review ? "update" : "create"}`;
}

function reviewFieldsEqual(left: ReviewFields, right: ReviewFields): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function reviewConflictComparisons(conflict: ReviewConflict) {
  const server = fieldsFromReview(conflict.latest);
  const labels: Record<keyof ReviewFields, string> = {
    summary: "今日完成",
    lostControl: "失控点",
    keepAction: "保留动作",
    tomorrowMinimum: "明日最低行动",
    mood: "情绪状态",
  };
  return (Object.keys(labels) as Array<keyof ReviewFields>).map((field) => ({
    field,
    label: labels[field],
    baseline: conflict.submitted.baselineFields[field],
    local: conflict.submitted.fields[field],
    server: server[field],
  }));
}

function isReviewDraft(value: unknown): value is ReviewDraft {
  if (!isObject(value) || typeof value.workspaceId !== "string" || typeof value.studyDayKey !== "string") return false;
  if (value.baseReviewId !== null && typeof value.baseReviewId !== "string") return false;
  if (value.baseRevision !== null && typeof value.baseRevision !== "number") return false;
  return isReviewFields(value.baselineFields) && isReviewFields(value.fields);
}

function isReviewFields(value: unknown): value is ReviewFields {
  return isObject(value) && ["summary", "lostControl", "keepAction", "tomorrowMinimum", "mood"]
    .every((field) => typeof value[field] === "string");
}

function isDailyReviewDto(value: unknown): value is DailyReviewDto {
  return isObject(value)
    && typeof value.id === "string"
    && typeof value.revision === "number"
    && typeof value.reviewDate === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
