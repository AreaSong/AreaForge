"use client";

import { isConflict, isUnauthorized } from "@/lib/client/api-errors";

import {
  createStageMilestone,
  updateStageMilestone,
} from "@/lib/api/stage";
import { Archive, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { Button } from "@/components/ui/button";
import { Card, SectionCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { SectionHeader } from "@/components/ui/page";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { PlanMilestoneConflictLatest, PlanMilestoneDto } from "@/lib/contracts";
import type { StagePlanDto } from "@/lib/contracts";
import {
  formatDate,
  isShanghaiDateInputError,
  isValidShanghaiDateInput,
  shanghaiDateInputToIso,
} from "@/lib/formatters";
import {
  createArchiveCommand,
  formPayload,
  isMilestoneArchiveCommand,
  isMilestoneConflictLatest,
  isMilestoneFormDraft,
  labelMilestoneError,
  milestoneConflictComparisons,
  nextMilestoneKey,
  samePayload,
  upsertMilestone,
  type MilestoneArchiveCommand,
  type MilestoneConflict,
  type MilestoneCreatePayload,
  type MilestoneFormDraft,
} from "@/components/stage-milestone-utils";

export function StageMilestoneManager({ plan, milestones, initialStableKey, returnTo }: {
  plan: StagePlanDto;
  milestones: PlanMilestoneDto[];
  initialStableKey?: string;
  returnTo?: string;
}) {
  const router = useRouter();
  const createDraftKey = `areaforge.command.plan-milestone.create-draft.${plan.id}`;
  const archiveDraftKey = `areaforge.command.plan-milestone.archive.${plan.id}`;
  const createCommandScope = `plan-milestone:create:${plan.id}`;
  const [rows, setRows] = useState(milestones);
  const [baseRevision, setBaseRevision] = useState(plan.revision);
  const [stableKey, setStableKey] = useState(initialStableKey ?? nextMilestoneKey(milestones));
  const [title, setTitle] = useState(initialStableKey ?? "");
  const [targetDate, setTargetDate] = useState("");
  const [firstSubmittedPayload, setFirstSubmittedPayload] = useState<MilestoneCreatePayload | null>(null);
  const [archiveCommand, setArchiveCommand] = useState<MilestoneArchiveCommand | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<MilestoneConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setRows(milestones), 0);
    return () => window.clearTimeout(timer);
  }, [milestones]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const restored = loadPrivateBusinessDraft(createDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isMilestoneFormDraft);
      if (restored) {
        setBaseRevision(restored.baseRevision);
        setStableKey(restored.stableKey);
        setTitle(restored.title);
        setTargetDate(restored.targetDate);
        setFirstSubmittedPayload(restored.firstSubmittedPayload);
        setDirty(true);
        if (restored.baseRevision !== plan.revision) {
          const submitted = restored.firstSubmittedPayload ?? formPayload(restored, plan.id, milestones.length);
          setConflict({
            type: "create",
            latest: { kind: "plan-milestone", milestone: null, stagePlan: plan },
            fields: ["stagePlan.revision"],
            submitted,
          });
          setConflictOpen(true);
        } else {
          setNotice(restored.firstSubmittedPayload
            ? "检测到尚未完成的里程碑创建命令，请核对后显式重试。"
            : "已恢复本地里程碑草稿。");
        }
      }

      const restoredArchive = loadPrivateBusinessDraft(archiveDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isMilestoneArchiveCommand);
      if (restoredArchive) {
        const current = milestones.find((row) => row.id === restoredArchive.milestoneId);
        if (current && Boolean(current.archivedAt) === restoredArchive.desiredArchived) {
          removePrivateBusinessDraft(archiveDraftKey);
        } else if (current && current.revision !== restoredArchive.baseRevision) {
          setArchiveCommand(restoredArchive);
          setConflict({
            type: "archive",
            latest: { kind: "plan-milestone", milestone: current, stagePlan: plan },
            fields: ["revision"],
            command: restoredArchive,
          });
          setConflictOpen(true);
        } else {
          setArchiveCommand(restoredArchive);
          setNotice("检测到尚未完成的里程碑状态命令，请在对应里程碑上显式重试。");
        }
      }
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [archiveDraftKey, createDraftKey, milestones, plan]);

  useEffect(() => {
    if (!draftReady || !dirty) return;
    savePrivateBusinessDraft<MilestoneFormDraft>(createDraftKey, {
      baseRevision,
      stableKey,
      title,
      targetDate,
      firstSubmittedPayload,
    });
  }, [baseRevision, createDraftKey, dirty, draftReady, firstSubmittedPayload, stableKey, targetDate, title]);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (conflict) {
      setConflictOpen(true);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = currentCreatePayload();
      const submitted = firstSubmittedPayload && samePayload(firstSubmittedPayload, payload)
        ? firstSubmittedPayload
        : payload;
      setFirstSubmittedPayload(submitted);
      setDirty(true);
      savePrivateBusinessDraft<MilestoneFormDraft>(createDraftKey, currentFormDraft(submitted));
      const response = await createStageMilestone({
        ...submitted,
        idempotencyKey: getOrCreateIdempotencyKey(createCommandScope, "plan-milestone", submitted),
      });
      const body = response.body;
      if (isUnauthorized(response)) {
        setError("登录已过期，里程碑草稿与创建命令已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok || !body?.milestone) {
        if (isConflict(response) && isMilestoneConflictLatest(body?.latest)) {
          setConflict({ type: "create", latest: body.latest, fields: body.conflictFields ?? [], submitted });
          setConflictOpen(true);
        }
        setError(labelMilestoneError(body?.error));
        if (response.status === 404 && body?.workbench) router.push(body.workbench);
        return;
      }
      const nextRows = upsertMilestone(rows, body.milestone as PlanMilestoneDto);
      setRows(nextRows);
      removePrivateBusinessDraft(createDraftKey);
      completeIdempotentCommand(createCommandScope);
      setStableKey(nextMilestoneKey(nextRows));
      setTitle("");
      setTargetDate("");
      setFirstSubmittedPayload(null);
      setDirty(false);
    } catch (caught) {
      setError(isShanghaiDateInputError(caught)
        ? "里程碑目标日期无效，请重新选择。"
        : "网络结果未知，里程碑草稿与创建命令已保留；请先核对服务端状态，再显式重试。");
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(row: PlanMilestoneDto) {
    if (saving) return;
    if (conflict) {
      setConflictOpen(true);
      return;
    }
    const desiredArchived = !row.archivedAt;
    if (archiveCommand && archiveCommand.milestoneId !== row.id) {
      setError("另一条里程碑状态命令尚未确认，请先处理对应里程碑。");
      return;
    }
    const activeCommand = archiveCommand
      && archiveCommand.milestoneId === row.id
      && archiveCommand.desiredArchived === desiredArchived
      && archiveCommand.baseRevision === row.revision
      ? archiveCommand
      : createArchiveCommand(row, desiredArchived);
    setArchiveCommand(activeCommand);
    savePrivateBusinessDraft(archiveDraftKey, activeCommand);
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await updateStageMilestone(row.id, activeCommand.firstSubmittedPayload);
      const body = response.body;
      if (isUnauthorized(response)) {
        setError("登录已过期，里程碑状态命令已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok || !body?.milestone) {
        if (isConflict(response) && isMilestoneConflictLatest(body?.latest)) {
          setConflict({ type: "archive", latest: body.latest, fields: body.conflictFields ?? [], command: activeCommand });
          setConflictOpen(true);
        }
        setError(labelMilestoneError(body?.error));
        if (response.status === 404 && body?.workbench) router.push(body.workbench);
        return;
      }
      setRows((current) => upsertMilestone(current, body.milestone as PlanMilestoneDto));
      removePrivateBusinessDraft(archiveDraftKey);
      setArchiveCommand(null);
    } catch {
      setError("网络结果未知，里程碑状态命令已保留；请先核对服务端状态，再显式重试。");
    } finally {
      setSaving(false);
    }
  }

  function currentCreatePayload(): MilestoneCreatePayload {
    return {
      stagePlanId: plan.id,
      expectedStagePlanRevision: baseRevision,
      stableKey: stableKey.trim(),
      title: title.trim(),
      targetDate: targetDate ? shanghaiDateInputToIso(targetDate) : null,
      sortOrder: rows.length,
    };
  }

  function currentFormDraft(submitted: MilestoneCreatePayload | null): MilestoneFormDraft {
    return { baseRevision, stableKey, title, targetDate, firstSubmittedPayload: submitted };
  }

  function adoptServerVersion() {
    if (!conflict) return;
    const latest = conflict.latest.milestone;
    if (latest) setRows((current) => upsertMilestone(current, latest));
    if (conflict.type === "create") {
      removePrivateBusinessDraft(createDraftKey);
      completeIdempotentCommand(createCommandScope);
      setStableKey("");
      setTitle("");
      setTargetDate("");
      setFirstSubmittedPayload(null);
      setDirty(false);
    } else {
      removePrivateBusinessDraft(archiveDraftKey);
      setArchiveCommand(null);
    }
    setConflict(null);
    setConflictOpen(false);
    setError(null);
    setNotice("已采用服务端里程碑状态，原命令未重放。");
  }

  function keepLocalIntent() {
    if (!conflict) return;
    if (conflict.type === "create") {
      const nextBaseRevision = conflict.latest.stagePlan?.revision ?? baseRevision;
      setBaseRevision(nextBaseRevision);
      setFirstSubmittedPayload(null);
      setDirty(true);
      completeIdempotentCommand(createCommandScope);
      savePrivateBusinessDraft<MilestoneFormDraft>(createDraftKey, {
        ...currentFormDraft(null),
        baseRevision: nextBaseRevision,
      });
      setNotice(conflict.latest.milestone
        ? "本地输入已保留，请修改冲突字段后显式提交新命令。"
        : "本地输入已基于最新 StagePlan 保留，请检查后显式提交新命令。");
    } else {
      const latest = conflict.latest.milestone;
      if (!latest || Boolean(latest.archivedAt) === conflict.command.desiredArchived) {
        adoptServerVersion();
        return;
      }
      const next = createArchiveCommand(latest, conflict.command.desiredArchived);
      setRows((current) => upsertMilestone(current, latest));
      setArchiveCommand(next);
      savePrivateBusinessDraft(archiveDraftKey, next);
      setNotice("已基于服务端最新 revision 保留状态意图，请显式重试。");
    }
    setConflict(null);
    setConflictOpen(false);
    setError(null);
  }

  function markFormEdited() {
    setDirty(true);
    setFirstSubmittedPayload(null);
  }

  return (
    <SectionCard variant="master" className="space-y-5 p-6" aria-labelledby="stage-milestones-heading">
      <SectionHeader
        title="里程碑"
        description="用关键日期把当前阶段拆成可检查的小目标。"
        meta={<span className="text-xs text-zinc-500">{rows.filter((r) => !r.archivedAt).length} 项进行中</span>}
      />
      {rows.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rows.map((row) => (
            <Card key={row.id} variant="subtle" className="flex flex-col justify-between p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${row.archivedAt ? "text-zinc-500 line-through" : "text-white"}`}>{row.title}</p>
                  <p className="mt-1 text-xs text-zinc-500">{row.targetDate ? formatDate(row.targetDate) : "未设置目标日期"}</p>
                </div>
                <Badge tone={row.archivedAt ? "neutral" : "success"}>{row.archivedAt ? "已归档" : "进行中"}</Badge>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-white/5">
                <span className="text-[11px] text-zinc-500 font-mono">{row.stableKey}</span>
                <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void toggleArchive(row)}>
                  {row.archivedAt ? <RotateCcw size={13} aria-hidden /> : <Archive size={13} aria-hidden />}
                  {row.archivedAt ? "恢复" : "归档"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card variant="subtle" className="p-4 text-center text-sm text-zinc-500">当前阶段还没有里程碑。</Card>
      )}
      <form className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-white/5" onSubmit={create}>
        <Field label="标题" htmlFor="milestone-title">
          <Input id="milestone-title" maxLength={200} required value={title} onChange={(event) => { setTitle(event.target.value); markFormEdited(); }} placeholder="例如：完成高数基础复习" />
        </Field>
        <Field label="目标日期" htmlFor="milestone-target-date">
          <Input id="milestone-target-date" type="date" value={targetDate} onChange={(event) => { setTargetDate(event.target.value); markFormEdited(); }} />
        </Field>
        <details className="sm:col-span-2 text-xs text-zinc-500">
          <summary className="cursor-pointer hover:text-zinc-300">高级选项</summary>
          <Field className="mt-2 max-w-md" label="内部标识" htmlFor="milestone-stable-key">
            <Input id="milestone-stable-key" maxLength={80} required value={stableKey} onChange={(event) => { setStableKey(event.target.value); markFormEdited(); }} />
          </Field>
        </details>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={saving}>{saving ? "保存中..." : "创建里程碑"}</Button>
          {returnTo ? <Link href={returnTo} className="text-sm text-teal-300 hover:underline">返回并重新预览导入</Link> : null}
        </div>
      </form>
      {notice ? <p role="status" className="text-sm text-teal-200">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="合并里程碑冲突"
        description="服务端里程碑或 StagePlan 已变化，原命令不会自动重放。"
        conflictFields={conflict?.fields ?? []}
        comparisons={conflict ? milestoneConflictComparisons(conflict) : []}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={adoptServerVersion}
        onManualMerge={keepLocalIntent}
      />
    </SectionCard>
  );
}
