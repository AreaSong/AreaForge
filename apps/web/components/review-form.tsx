"use client";

import { createDailyReview, updateDailyReview } from "@/lib/api/daily-review";
import { Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { DailyReviewResult } from "@/components/daily-review-result";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EditorActionBar } from "@/components/ui/editor-actions";
import { Alert, PersistenceStatus } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SectionHeader } from "@/components/ui/page";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import {
  loadPrivateBusinessDraft,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
  SHORT_PRIVATE_DRAFT_TTL_MS,
} from "@/lib/client/private-business-drafts";
import { useUnsavedChangesWarning } from "@/lib/client/use-unsaved-changes-warning";
import type { PlanInboxItemDto } from "@/lib/contracts";
import type { DailyReviewDto } from "@/lib/contracts";
import { classifyApiFailure } from "@/lib/client/api-errors";

interface ReviewFormProps {
  userId: string;
  workspaceId: string;
  studyDayKey: string;
  review: DailyReviewDto | null;
  inboxItem: PlanInboxItemDto | null;
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

export function ReviewForm({ userId, workspaceId, studyDayKey, review, inboxItem: initialInboxItem }: ReviewFormProps) {
  const router = useRouter();
  const draftKey = `areaforge.daily-review.draft.${userId}.${workspaceId}.${studyDayKey}`;
  const [baseline, setBaseline] = useState(review);
  const [inboxItem, setInboxItem] = useState(initialInboxItem);
  const [fields, setFields] = useState<ReviewFields>(() => fieldsFromReview(review));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [conflict, setConflict] = useState<ReviewConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const currentMood = fields.mood;
  const dirty = !reviewFieldsEqual(fields, fieldsFromReview(baseline));
  const hasLegacyMood = currentMood.length > 0 && !moodOptions.includes(currentMood as (typeof moodOptions)[number]);

  useUnsavedChangesWarning(dirty);

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
    const payload = submission.fields;

    try {
      const idempotencyKey = getOrCreateIdempotencyKey(commandScope, "daily-review", {
        ...(baseline ? { expectedRevision: baseline.revision } : {}),
        ...payload,
      });
      const response = baseline
        ? await updateDailyReview(baseline.id, {
            ...payload,
            expectedRevision: baseline.revision,
            idempotencyKey,
          })
        : await createDailyReview({ ...payload, idempotencyKey });
      const body = response.body;
      const failure = classifyApiFailure(response);

      if (failure.kind === "unauthorized") {
        setError("登录已过期，复盘草稿已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (response.status === 404) {
        completeIdempotentCommand(commandScope);
        setError("这份复盘已不可用，草稿仍保留；正在返回复盘工作台。");
        router.replace("/roadmap/reviews/daily");
        return;
      }
      if (failure.kind === "conflict" && isDailyReviewDto(body?.latest)) {
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
      setInboxItem(isPlanInboxItemDto(body.inboxItem) ? body.inboxItem : null);
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
      {baseline ? <DailyReviewResult review={baseline} inboxItem={inboxItem} /> : null}
      <section className="space-y-6 pb-20" aria-labelledby="review-judgement-heading">
        <SectionHeader
          title={baseline ? "调整今天的判断" : "留下今天的判断"}
          description="事实已经由系统记录；这里保留你的判断，不让数据替你下结论。"
          meta={<PersistenceStatus state={conflict ? "conflict" : saving || isPending ? "saving" : dirty ? "local-draft" : saved ? "saved" : "clean"} />}
        />
        <form onSubmit={submit} className="space-y-6">
          <Card variant="master" className="p-6 space-y-4">
            <h2 id="review-judgement-heading" className="text-sm font-semibold text-teal-300">1. 推进与偏差</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="今天实际推进了什么" htmlFor="daily-review-summary">
                <Textarea
                  id="daily-review-summary"
                  name="summary"
                  className="min-h-28"
                  placeholder="用自己的话概括真正推进的内容"
                  value={fields.summary}
                  onChange={(event) => setFields((current) => ({ ...current, summary: event.target.value }))}
                  required
                />
              </Field>
              <Field label="哪里偏离了计划" htmlFor="daily-review-lost-control">
                <Textarea
                  id="daily-review-lost-control"
                  name="lostControl"
                  className="min-h-28"
                  placeholder="没有明显偏差可以留空"
                  value={fields.lostControl}
                  onChange={(event) => setFields((current) => ({ ...current, lostControl: event.target.value }))}
                />
              </Field>
            </div>
          </Card>

          <Card variant="master" className="p-6 space-y-4">
            <h2 className="text-sm font-semibold text-teal-300">2. 保留有效动作与当前状态</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="明天应该继续做什么" htmlFor="daily-review-keep-action">
                <Input
                  id="daily-review-keep-action"
                  name="keepAction"
                  placeholder="只保留一个真正有效的动作"
                  value={fields.keepAction}
                  onChange={(event) => setFields((current) => ({ ...current, keepAction: event.target.value }))}
                  required
                />
              </Field>
              <Field label="当前状态" htmlFor="daily-review-mood">
                <Select
                  id="daily-review-mood"
                  name="mood"
                  value={fields.mood}
                  onChange={(event) => setFields((current) => ({ ...current, mood: event.target.value }))}
                >
                  <option value="">不记录</option>
                  {hasLegacyMood ? <option value={currentMood}>当前记录：{currentMood}</option> : null}
                  {moodOptions.map((mood) => <option key={mood} value={mood}>{mood}</option>)}
                </Select>
              </Field>
            </div>
          </Card>

          <Card variant="accent" className="p-6 space-y-3 border-teal-500/30 shadow-[0_0_16px_rgba(45,212,191,0.15)]">
            <h2 className="text-sm font-semibold text-teal-200">3. 确定明日最低行动</h2>
            <Field label="即使状态不好，明天也必须完成的一个动作" htmlFor="daily-review-tomorrow-minimum">
              <Input
                id="daily-review-tomorrow-minimum"
                name="tomorrowMinimum"
                className="text-base"
                placeholder="例如：完成极限基础练习 20 题"
                value={fields.tomorrowMinimum}
                onChange={(event) => setFields((current) => ({ ...current, tomorrowMinimum: event.target.value }))}
                required
              />
            </Field>
            <p className="text-xs leading-relaxed text-zinc-400">保存后会进入投入草稿，由你补全科目和预计时长，再转为正式任务。</p>
          </Card>

          <EditorActionBar
            primaryType="submit"
            primaryLabel={baseline ? "更新复盘与明日行动" : "完成复盘"}
            primaryIcon={<Save size={16} aria-hidden />}
            primaryDisabled={conflict !== null}
            loading={saving || isPending}
            hint="复盘和明日行动会一起保存，不会出现半份结果。"
          />
        </form>
        <div aria-live="polite">
          {saved ? <p className="sr-only">复盘与明日最低行动已保存。</p> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
        {conflict && !conflictOpen ? (
          <Button type="button" variant="ghost" size="sm" className="!h-auto !min-h-0 !px-0 !py-0 !text-sm !font-normal text-amber-200 hover:!bg-transparent hover:underline" onClick={() => setConflictOpen(true)}>
            处理复盘版本冲突
          </Button>
        ) : null}
      </section>
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

function isPlanInboxItemDto(value: unknown): value is PlanInboxItemDto {
  if (!isObject(value)) return false;
  return typeof value.id === "string"
    && typeof value.originKey === "string"
    && typeof value.originVersion === "number"
    && (value.status === "OPEN" || value.status === "DISMISSED" || value.status === "CONVERTED")
    && typeof value.revision === "number"
    && Array.isArray(value.missingFields)
    && Array.isArray(value.dependencyRefs);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
