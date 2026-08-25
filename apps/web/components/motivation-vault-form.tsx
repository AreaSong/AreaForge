"use client";

import { isConflict, isUnauthorized } from "@/lib/client/api-errors";

import { Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/page";
import { saveMotivationVault } from "@/lib/api/motivation";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { MotivationVaultDto } from "@/lib/contracts";
import { formatDateTime } from "@/lib/formatters";

interface MotivationVaultFormProps {
  userId: string;
  vault: MotivationVaultDto | null;
}

interface MotivationVaultFields {
  whyStarted: string;
  neverReturnTo: string;
  futureSelf: string;
  messageToFuture: string;
  firstSimulationDiary: string;
}

interface MotivationVaultDraft {
  baseUpdatedAt: string | null;
  fields: MotivationVaultFields;
}

interface MotivationVaultConflict {
  submitted: MotivationVaultDraft;
  latest: MotivationVaultDto | null;
  conflictFields: string[];
}

export function MotivationVaultForm({ userId, vault }: MotivationVaultFormProps) {
  const router = useRouter();
  const draftKey = `areaforge.motivation-vault.draft.${userId}`;
  const [whyStarted, setWhyStarted] = useState(vault?.whyStarted ?? "");
  const [neverReturnTo, setNeverReturnTo] = useState(vault?.neverReturnTo ?? "");
  const [futureSelf, setFutureSelf] = useState(vault?.futureSelf ?? "");
  const [messageToFuture, setMessageToFuture] = useState(vault?.messageToFuture ?? "");
  const [firstSimulationDiary, setFirstSimulationDiary] = useState(vault?.firstSimulationDiary ?? "");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(vault?.updatedAt ?? null);
  const [savedFields, setSavedFields] = useState<MotivationVaultFields>(() => fieldsFromVault(vault));
  const [conflict, setConflict] = useState<MotivationVaultConflict | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft = loadPrivateBusinessDraft(draftKey, LONG_PRIVATE_DRAFT_TTL_MS, isMotivationVaultDraft);
      if (draft) {
        setWhyStarted(draft.fields.whyStarted);
        setNeverReturnTo(draft.fields.neverReturnTo);
        setFutureSelf(draft.fields.futureSelf);
        setMessageToFuture(draft.fields.messageToFuture);
        setFirstSimulationDiary(draft.fields.firstSimulationDiary);
        if (draft.baseUpdatedAt !== (vault?.updatedAt ?? null)) {
          setConflict({
            submitted: draft,
            latest: vault,
            conflictFields: ["updatedAt"],
          });
        }
      }
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftKey, vault]);

  useEffect(() => {
    if (!draftReady) return;
    const fields = { whyStarted, neverReturnTo, futureSelf, messageToFuture, firstSimulationDiary };
    if (motivationVaultFieldsEqual(fields, savedFields)) {
      removePrivateBusinessDraft(draftKey);
      return;
    }
    savePrivateBusinessDraft<MotivationVaultDraft>(draftKey, {
      baseUpdatedAt: savedAt,
      fields,
    });
  }, [draftKey, draftReady, firstSimulationDiary, futureSelf, messageToFuture, neverReturnTo, savedAt, savedFields, whyStarted]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const fields: MotivationVaultFields = {
        whyStarted,
        neverReturnTo,
        futureSelf,
        messageToFuture,
        firstSimulationDiary,
      };
      const submission: MotivationVaultDraft = { baseUpdatedAt: savedAt, fields: structuredClone(fields) };
      savePrivateBusinessDraft(draftKey, submission);
      const commandScope = `motivation-vault:${userId}`;
      const response = await saveMotivationVault({
        ...submission.fields,
        expectedUpdatedAt: submission.baseUpdatedAt,
        idempotencyKey: getOrCreateIdempotencyKey(commandScope, "motivation-vault", submission),
      });
      if (isUnauthorized(response)) {
        setError("登录已过期，草稿已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        const body = response.body;
        if (isConflict(response) && body && "latest" in body) {
          setConflict({
            submitted: submission,
            latest: isMotivationVaultDto(body.latest) ? body.latest : null,
            conflictFields: body.conflictFields ?? ["updatedAt"],
          });
        }
        setError(body?.error ?? "保存动机档案失败，草稿已保留");
        return;
      }

      const body = response.body;
      if (!body?.vault) {
        setError("服务端未返回已保存的动机档案，草稿仍保留");
        return;
      }
      completeIdempotentCommand(commandScope);
      setSavedAt(body.vault.updatedAt);
      const nextFields = fieldsFromVault(body.vault);
      setSavedFields(nextFields);
      setWhyStarted(nextFields.whyStarted);
      setNeverReturnTo(nextFields.neverReturnTo);
      setFutureSelf(nextFields.futureSelf);
      setMessageToFuture(nextFields.messageToFuture);
      setFirstSimulationDiary(nextFields.firstSimulationDiary);
      removePrivateBusinessDraft(draftKey);
      startTransition(() => router.refresh());
    } catch {
      setError("网络不可用，草稿已保留；恢复网络后请显式重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <section className="space-y-5">
      <SectionHeader
        title="动机封存"
        description="这些内容只在关键节点由你主动使用。未保存的输入会保留在当前浏览器，发生版本冲突时不会自动覆盖。"
        meta={savedAt ? <span className="text-xs text-zinc-500">上次保存 {formatDateTime(savedAt)}</span> : null}
      />
      <form className="af-content-grid-two grid gap-4" onSubmit={submit}>
          <MotivationTextarea
            label="为什么开始"
            value={whyStarted}
            onChange={setWhyStarted}
            placeholder="写下开始这场长期备考的真实原因"
            disabled={saving}
          />
          <MotivationTextarea
            label="最不想回到什么状态"
            value={neverReturnTo}
            onChange={setNeverReturnTo}
            placeholder="记录那个必须远离的状态"
            disabled={saving}
          />
          <MotivationTextarea
            label="想成为怎样的人"
            value={futureSelf}
            onChange={setFutureSelf}
            placeholder="描述长期训练后你要变成的人"
            disabled={saving}
          />
          <MotivationTextarea
            label="给未来自己的话"
            value={messageToFuture}
            onChange={setMessageToFuture}
            placeholder="留给未来某个失守或冲刺时刻的自己"
            disabled={saving}
          />
          <MotivationTextarea
            label="第一次全真自测后的阶段日记"
            value={firstSimulationDiary}
            onChange={setFirstSimulationDiary}
            placeholder="第一次全真自测后再回来补这一段"
            disabled={saving}
            className="af-content-span-all"
          />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={saving || isPending}
            loadingLabel="正在保存"
            disabled={isPending || saving}
            className="af-container-action af-content-span-all"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            保存封存内容
          </Button>
      </form>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <details className="border-t border-white/10 pt-4">
        <summary className="cursor-pointer text-sm font-medium text-zinc-300">查看动机内容的唤醒原则</summary>
        <div className="af-metric-grid-four mt-4 grid gap-3">
          <Principle title="连续失守" body="当连续性断裂时，只短暂回看一次原因，然后回到恢复任务。" />
          <Principle title="重大复盘" body="当复盘暴露结构性问题时，用动机校准方向，不用它替代行动。" />
          <Principle title="全真自测" body="第一次全真自测前后，用它确认这次模拟的意义和下一阶段压力。" />
          <Principle title="危险期" body="风险等级升高时唤醒底层理由，但不把敏感内容放到首页常驻展示。" />
        </div>
      </details>
    </section>
    <ConflictResolutionModal
      open={conflict !== null}
      title="动机档案已在其他页面更新"
      description="本地草稿和服务端最新值都已保留。系统不会自动覆盖或重放，请检查差异后决定下一步。"
      conflictFields={conflict?.conflictFields ?? []}
      comparisons={conflict ? motivationVaultComparisons(conflict, savedFields) : []}
      onAdoptServer={() => {
        if (!conflict) return;
        const next = fieldsFromVault(conflict.latest);
        setWhyStarted(next.whyStarted);
        setNeverReturnTo(next.neverReturnTo);
        setFutureSelf(next.futureSelf);
        setMessageToFuture(next.messageToFuture);
        setFirstSimulationDiary(next.firstSimulationDiary);
        setSavedFields(next);
        setSavedAt(conflict.latest?.updatedAt ?? null);
        removePrivateBusinessDraft(draftKey);
        setConflict(null);
        setError(null);
      }}
      onManualMerge={() => {
        if (!conflict) return;
        setSavedFields(fieldsFromVault(conflict.latest));
        setSavedAt(conflict.latest?.updatedAt ?? null);
        setConflict(null);
        setError("已采用服务端最新基线并保留本地输入；合并后请再次点击保存，不会自动重放");
      }}
    />
    </>
  );
}

function fieldsFromVault(vault: MotivationVaultDto | null): MotivationVaultFields {
  return {
    whyStarted: vault?.whyStarted ?? "",
    neverReturnTo: vault?.neverReturnTo ?? "",
    futureSelf: vault?.futureSelf ?? "",
    messageToFuture: vault?.messageToFuture ?? "",
    firstSimulationDiary: vault?.firstSimulationDiary ?? "",
  };
}

function motivationVaultFieldsEqual(left: MotivationVaultFields, right: MotivationVaultFields): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function motivationVaultComparisons(
  conflict: MotivationVaultConflict,
  baseline: MotivationVaultFields,
) {
  const latest = fieldsFromVault(conflict.latest);
  const labels: Record<keyof MotivationVaultFields, string> = {
    whyStarted: "为什么开始",
    neverReturnTo: "最不想回到什么状态",
    futureSelf: "想成为怎样的人",
    messageToFuture: "给未来自己的话",
    firstSimulationDiary: "第一次全真自测后的阶段日记",
  };
  return (Object.keys(labels) as Array<keyof MotivationVaultFields>).map((field) => ({
    field,
    label: labels[field],
    baseline: baseline[field],
    local: conflict.submitted.fields[field],
    server: latest[field],
  }));
}

function isMotivationVaultDto(value: unknown): value is MotivationVaultDto {
  if (!value || typeof value !== "object") return false;
  const vault = value as Partial<MotivationVaultDto>;
  return typeof vault.id === "string"
    && typeof vault.updatedAt === "string"
    && [vault.whyStarted, vault.neverReturnTo, vault.futureSelf, vault.messageToFuture, vault.firstSimulationDiary]
      .every((field) => field === null || typeof field === "string");
}

function isMotivationVaultDraft(value: unknown): value is MotivationVaultDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<MotivationVaultDraft>;
  if (!(draft.baseUpdatedAt === null || typeof draft.baseUpdatedAt === "string") || !draft.fields) return false;
  return [draft.fields.whyStarted, draft.fields.neverReturnTo, draft.fields.futureSelf, draft.fields.messageToFuture, draft.fields.firstSimulationDiary]
    .every((field) => typeof field === "string");
}

function MotivationTextarea({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled: boolean;
  className?: string;
}) {
  return (
    <label className={`grid gap-2 text-sm text-zinc-300 ${className ?? ""}`}>
      <span>{label}</span>
      <Textarea
        controlHeight="md"
        className="min-h-24 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm leading-6 text-zinc-100"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </label>
  );
}

function Principle({ title, body }: { title: string; body: string }) {
  return (
    <article className="border-l-2 border-teal-400/30 pl-3">
      <h3 className="font-medium text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-400">{body}</p>
    </article>
  );
}
