"use client";

import { ChevronLeft, ChevronRight, Save } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Input } from "@/components/ui/field";
import { SectionHeader } from "@/components/ui/page";
import { readWeeklyBudget, updateWeeklyBudget } from "@/lib/api/weekly-budget";
import { classifyApiFailure } from "@/lib/client/api-errors";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import type { WeeklyBudgetDto } from "@/lib/contracts";

export function WeeklyBudgetPlanner(props: {
  budget: WeeklyBudgetDto;
  onBudgetChange: (budget: WeeklyBudgetDto) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() => toDrafts(props.budget));
  const [pendingSubjectId, setPendingSubjectId] = useState<string | null>(null);
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadWeek(weekStart: string) {
    if (loadingWeek || pendingSubjectId) return;
    setLoadingWeek(true);
    setError(null);
    setNotice(null);
    try {
      const result = await readWeeklyBudget(weekStart);
      if (!result.ok || !result.body?.budget) {
        const failure = classifyApiFailure(result);
        if (failure.kind === "unauthorized") return redirectToLoginWithCurrentLocation();
        setError("周预算读取失败，当前页面仍保留原数据。");
        return;
      }
      props.onBudgetChange(result.body.budget);
    } catch {
      setError("网络不可用，无法切换周预算。");
    } finally {
      setLoadingWeek(false);
    }
  }

  async function saveSubject(subjectId: string) {
    const subject = props.budget.subjects.find((item) => item.subjectId === subjectId);
    if (!subject || pendingSubjectId) return;
    const value = Number(drafts[subjectId] ?? "");
    if (!Number.isInteger(value) || value < 0 || value > 7 * 24 * 60) {
      setError("周预算必须是 0 到 10080 之间的整数分钟；填 0 可清空该科预算。");
      return;
    }
    setPendingSubjectId(subjectId);
    setError(null);
    setNotice(null);
    try {
      const result = await updateWeeklyBudget({
        weekStart: props.budget.weekStart,
        subjectId,
        targetMinutes: value,
        expectedRevision: subject.revision,
      });
      if (!result.ok || !result.body?.budget) {
        const failure = classifyApiFailure(result);
        if (failure.kind === "unauthorized") return redirectToLoginWithCurrentLocation();
        if (failure.kind === "conflict" && result.body?.latest) {
          props.onBudgetChange(result.body.latest);
          setError("该周预算已在其他页面更新，已载入最新版本；请核对后重试。");
          return;
        }
        setError("周预算未保存，当前输入仍保留。");
        return;
      }
      props.onBudgetChange(result.body.budget);
      setNotice(value > 0 ? `${subject.subjectName}的周预算已保存。` : `${subject.subjectName}的周预算已清空。`);
    } catch {
      setError("网络不可用，周预算未保存。");
    } finally {
      setPendingSubjectId(null);
    }
  }

  return (
    <section className="border-y border-white/10 bg-white/[0.015] px-3.5 py-4 sm:px-4" aria-labelledby="weekly-budget-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          title="每周科目投入预算"
          description="按自然周分配真实可用时间；预算只用于取舍，不会自动创建任务。"
        />
        <div className="flex items-center gap-1.5" aria-label="切换预算周">
          <Button type="button" variant="ghost" size="sm" title="上一周" aria-label="上一周" disabled={loadingWeek || Boolean(pendingSubjectId)} onClick={() => void loadWeek(shiftWeek(props.budget.weekStart, -1))}>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <span className="min-w-36 text-center font-mono text-xs text-zinc-300">
            {props.budget.weekStart} 至 {props.budget.weekEnd}
          </span>
          <Button type="button" variant="ghost" size="sm" title="下一周" aria-label="下一周" disabled={loadingWeek || Boolean(pendingSubjectId)} onClick={() => void loadWeek(shiftWeek(props.budget.weekStart, 1))}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {props.budget.subjects.map((subject) => {
          const pending = pendingSubjectId === subject.subjectId;
          return (
            <div key={subject.subjectId} className="flex min-w-0 items-end gap-2 border-b border-white/5 pb-2">
              <label className="min-w-0 flex-1 text-xs text-zinc-400">
                <span className="mb-1.5 flex min-w-0 items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: subject.subjectColor }} />
                  <span className="truncate text-zinc-200">{subject.subjectName}</span>
                  <span className="shrink-0 text-zinc-600">r{subject.revision}</span>
                </span>
                <Input
                  type="number"
                  min={0}
                  max={7 * 24 * 60}
                  step={15}
                  inputMode="numeric"
                  aria-label={`${subject.subjectName}周预算分钟`}
                  value={drafts[subject.subjectId] ?? ""}
                  placeholder="未设置"
                  onChange={(event) => setDrafts((current) => ({ ...current, [subject.subjectId]: event.target.value }))}
                />
              </label>
              <span className="pb-2 text-xs text-zinc-500">分钟</span>
              <Button type="button" variant="secondary" size="sm" title={`保存${subject.subjectName}预算`} aria-label={`保存${subject.subjectName}预算`} disabled={Boolean(pendingSubjectId) || loadingWeek} loading={pending} onClick={() => void saveSubject(subject.subjectId)}>
                <Save className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
        <span>已配置 {props.budget.configuredSubjectCount}/{props.budget.subjects.length} 科</span>
        <span>预算 {formatMinutes(props.budget.totalTargetMinutes)}</span>
        <span>实际 {formatMinutes(props.budget.totalActualMinutes)}</span>
        <span>有效 {formatMinutes(props.budget.totalEffectiveMinutes)}</span>
      </div>
      {notice ? <p className="mt-3 text-xs text-teal-300" role="status">{notice}</p> : null}
      {error ? <div className="mt-3"><Alert tone="danger">{error}</Alert></div> : null}
    </section>
  );
}

function toDrafts(budget: WeeklyBudgetDto): Record<string, string> {
  return Object.fromEntries(budget.subjects.map((subject) => [subject.subjectId, subject.targetMinutes?.toString() ?? ""]));
}

function shiftWeek(weekStart: string, delta: -1 | 1): string {
  const [year, month, day] = weekStart.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + delta * 7));
  return date.toISOString().slice(0, 10);
}

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "0 分";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours} 小时${rest ? ` ${rest} 分` : ""}` : `${rest} 分`;
}
