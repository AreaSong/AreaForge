"use client";

import { isConflict, isUnauthorized } from "@/lib/client/api-errors";

import {
  createStageAdjustmentDraft,
  decideStageAdjustmentDraft,
} from "@/lib/api/stage";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/overlays";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import { selectStageDecisionBaseline } from "@/lib/client/versioned-conflict-baseline";
import { useVersionedDecisionCommand } from "@/lib/client/use-versioned-decision-command";
import { useKeyedDraftHydration } from "@/lib/client/use-keyed-draft-hydration";
import type { StageAdjustmentConflictLatest } from "@/lib/contracts";
import type { StageAdjustmentDraftRecordDto } from "@/lib/contracts";

type StageDecisionAction = "confirm" | "reject";

interface StageDecisionCommand {
  action: StageDecisionAction;
  baseRevision: number;
  firstSubmittedPayload: { expectedRevision: number };
  firstSubmittedSnapshot: StageAdjustmentDraftRecordDto;
}

interface StageDecisionConflict {
  command: StageDecisionCommand;
  latest: StageAdjustmentConflictLatest;
  fields: string[];
}

export function StageDraftCreateAction({ stagePlanId, label = "生成阶段草稿" }: { stagePlanId: string; label?: string }) {
  const router = useRouter();
  const commandScope = `stage-adjustment-draft:${stagePlanId}`;
  const payload = { stagePlanId };
  const [pending, startTransition] = useTransition();
  const createCommand = useVersionedDecisionCommand<typeof payload>();
  const creating = createCommand.pending;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ latest: StageAdjustmentConflictLatest; fields: string[] } | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);

  async function createDraft() {
    if (creating) return;
    if (conflict) {
      setConflictOpen(true);
      return;
    }
    setError(null);
    setNotice(null);
    const generation = createCommand.begin(payload);
    if (generation === null) return;
    try {
      const response = await createStageAdjustmentDraft({
        ...payload,
        idempotencyKey: getOrCreateIdempotencyKey(commandScope, "stage-draft", payload),
      });
      const body = response.body;
      if (isUnauthorized(response)) {
        setError("登录已过期，生成命令已保留。重新登录后请显式重试。");
        createCommand.fail(generation, "登录已过期，生成命令已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        if (isConflict(response) && isStageAdjustmentConflictLatest(body?.latest)) {
          setConflict({ latest: body.latest, fields: body.conflictFields ?? [] });
          setConflictOpen(true);
        }
        setError(body?.error ?? "生成阶段草稿失败，当前命令仍保留");
        createCommand.fail(generation, body?.error ?? "生成阶段草稿失败，当前命令仍保留");
        if (response.status === 404 && body?.workbench) router.push(body.workbench);
        return;
      }
      if (!body?.draft) {
        setError("服务端未返回阶段草稿，当前重试标识仍保留");
        createCommand.fail(generation, "服务端未返回阶段草稿，当前重试标识仍保留");
        return;
      }
      completeIdempotentCommand(commandScope);
      createCommand.succeed(generation);
      startTransition(() => router.refresh());
    } catch {
      setError("网络结果未知，生成命令仍保留；请先核对服务端状态，再显式重试。");
      createCommand.fail(generation, "网络结果未知，生成命令仍保留；请先核对服务端状态，再显式重试。");
    }
  }

  function adoptCreatedDraft() {
    completeIdempotentCommand(commandScope);
    setConflict(null);
    setConflictOpen(false);
    setError(null);
    setNotice("已采用服务端阶段状态，原命令未重放。");
    startTransition(() => router.refresh());
  }

  function prepareNewCreateCommand() {
    completeIdempotentCommand(commandScope);
    setConflict(null);
    setConflictOpen(false);
    setError(null);
    setNotice("已放弃冲突命令；再次点击时会创建新的显式命令。");
  }

  return (
    <div>
      <Button
        type="button"
        variant="secondary"
        size="md"
        loading={creating}
        loadingLabel="生成中..."
        disabled={pending}
        onClick={() => void createDraft()}
        className="!border-teal-300/30 !bg-transparent !text-teal-200 disabled:!opacity-60"
      >
        {label}
      </Button>
      {notice ? <p role="status" className="mt-2 text-sm text-teal-200">{notice}</p> : null}
      {error ? <p role="alert" className="mt-2 text-sm text-red-300">{error}</p> : null}
      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="处理阶段草稿生成冲突"
        description="服务端阶段状态已变化，生成命令不会自动重放。"
        conflictFields={conflict?.fields ?? []}
        comparisons={conflict ? [
          { field: "stagePlanId", label: "阶段计划", local: stagePlanId, server: conflict.latest.stagePlan?.id ?? null },
          { field: "draft.status", label: "服务端草稿状态", local: "待生成", server: conflict.latest.draft?.status ?? "无草稿" },
        ] : []}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={adoptCreatedDraft}
        onManualMerge={prepareNewCreateCommand}
        mergeLabel="放弃旧命令并准备新命令"
      />
    </div>
  );
}

export function StageDraftActions({ draft }: { draft: StageAdjustmentDraftRecordDto }) {
  const router = useRouter();
  const [baselineOverride, setBaselineOverride] = useState<StageAdjustmentDraftRecordDto | null>(null);
  const decisionCommand = useVersionedDecisionCommand<StageDecisionCommand>();
  const {
    command,
    pending: decisionPending,
    begin: beginDecision,
    succeed: succeedDecision,
    fail: failDecision,
    restore: restoreDecision,
  } = decisionCommand;
  const [conflict, setConflict] = useState<StageDecisionConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const baseline = selectStageDecisionBaseline(draft, baselineOverride);
  const commandKey = stageDecisionCommandKey(baseline.id);
  const {
    begin: beginHydration,
    isCurrent: isHydrationCurrent,
    complete: completeHydration,
    cancel: cancelHydration,
  } = useKeyedDraftHydration(commandKey);
  const deciding = decisionPending;

  useEffect(() => {
    const token = beginHydration();
    const timer = window.setTimeout(() => {
      if (!isHydrationCurrent(token)) return;
      const restored = loadPrivateBusinessDraft(commandKey, LONG_PRIVATE_DRAFT_TTL_MS, isStageDecisionCommand);
      if (!restored) {
        completeHydration(token);
        return;
      }
      if (baseline.status === stageActionStatus(restored.action)) {
        removePrivateBusinessDraft(commandKey);
        completeHydration(token);
        return;
      }
      restoreDecision(restored);
      if (restored.baseRevision !== baseline.revision || baseline.status !== "draft") {
        setConflict({
          command: restored,
          latest: { kind: "stage-adjustment-decision", draft: baseline, stagePlan: null },
          fields: restored.baseRevision !== baseline.revision ? ["draft.revision"] : ["draft.status"],
        });
        setConflictOpen(true);
        completeHydration(token);
        return;
      }
      setNotice("检测到尚未完成的阶段决策，请核对当前版本后显式重试。");
      completeHydration(token);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      cancelHydration(token);
    };
  }, [baseline, beginHydration, cancelHydration, commandKey, completeHydration, isHydrationCurrent, restoreDecision]);

  async function decide(action: StageDecisionAction) {
    if (deciding) return;
    if (conflict) {
      setConflictOpen(true);
      return;
    }
    setError(null);
    setNotice(null);
    const activeCommand = command?.action === action && command.baseRevision === baseline.revision
      ? command
      : createStageDecisionCommand(action, baseline);
    const generation = beginDecision(activeCommand);
    if (generation === null) return;
    savePrivateBusinessDraft(commandKey, activeCommand);
    try {
      const response = await decideStageAdjustmentDraft(
        baseline.id,
        action,
        activeCommand.firstSubmittedPayload,
      );
      const body = response.body;
      if (isUnauthorized(response)) {
        setError("登录已过期，阶段决策命令已保留。重新登录后请显式重试。");
        failDecision(generation, "登录已过期，阶段决策命令已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        if (isConflict(response) && isStageAdjustmentConflictLatest(body?.latest)) {
          setConflict({ command: activeCommand, latest: body.latest, fields: body.conflictFields ?? [] });
          setConflictOpen(true);
        }
        setError(body?.error ?? "阶段决策失败，当前命令仍保留");
        failDecision(generation, body?.error ?? "阶段决策失败，当前命令仍保留");
        if (response.status === 404 && body?.workbench) router.push(body.workbench);
        return;
      }
      if (!body?.draft) {
        setError("服务端未返回阶段草稿，当前命令仍保留。");
        failDecision(generation, "服务端未返回阶段草稿，当前命令仍保留。");
        return;
      }
      removePrivateBusinessDraft(commandKey);
      succeedDecision(generation);
      const inbox = body.inboxResult;
      const counts = inbox ? `入箱新增 ${inbox.createdCount}，复用 ${inbox.reusedCount}，替代 ${inbox.supersededCount}` : "";
      setNotice(action === "confirm" ? `阶段计划已更新，${counts}；现有任务未被修改。` : "阶段草稿已不可逆拒绝。");
      startTransition(() => router.refresh());
    } catch {
      setError("网络结果未知，阶段决策命令已保留；请先核对服务端状态，再显式重试。");
      failDecision(generation, "网络结果未知，阶段决策命令已保留；请先核对服务端状态，再显式重试。");
    }
  }

  function adoptServerVersion() {
    if (!conflict) return;
    removePrivateBusinessDraft(commandKey);
    restoreDecision(null);
    if (conflict.latest.draft) setBaselineOverride(conflict.latest.draft);
    setConflict(null);
    setConflictOpen(false);
    setError(null);
    setNotice("已采用服务端阶段状态，原命令未重放。");
    startTransition(() => router.refresh());
  }

  function keepIntentOnLatestRevision() {
    if (!conflict?.latest.draft || conflict.latest.draft.status !== "draft") {
      adoptServerVersion();
      return;
    }
    const latest = conflict.latest.draft;
    const next = createStageDecisionCommand(conflict.command.action, latest);
    const nextCommandKey = stageDecisionCommandKey(latest.id);
    if (nextCommandKey !== commandKey) removePrivateBusinessDraft(commandKey);
    savePrivateBusinessDraft(nextCommandKey, next);
    restoreDecision(next);
    setBaselineOverride(latest);
    setConflict(null);
    setConflictOpen(false);
    setError(null);
    setNotice("已基于服务端最新 revision 保留决策意图，请检查后显式重试。");
    startTransition(() => router.refresh());
  }

  return (
    <div className="mt-4">
      <div className="af-action-cluster">
        <Button type="button" variant="primary" size="lg" loading={deciding && command?.action === "confirm"} disabled={pending || deciding || baseline.status !== "draft"} onClick={() => void decide("confirm")}>确认并更新阶段</Button>
        <Button type="button" variant="danger" size="lg" disabled={pending || deciding || baseline.status !== "draft"} onClick={() => setRejectConfirmOpen(true)}>拒绝</Button>
      </div>
      {notice ? <Alert tone="success" className="mt-3">{notice}</Alert> : null}
      {error ? <Alert tone="danger" className="mt-3">{error}</Alert> : null}

      <Modal open={rejectConfirmOpen} title="确认不可逆拒绝" onClose={() => setRejectConfirmOpen(false)} allowEscape={false}>
        <div className="space-y-4 text-sm text-zinc-300">
          <p>拒绝后当前阶段草稿进入终态，不能恢复、确认或再次拒绝。重新评估必须生成新版本。</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="md" onClick={() => setRejectConfirmOpen(false)}>取消</Button>
            <Button type="button" variant="danger" size="md" onClick={() => { setRejectConfirmOpen(false); void decide("reject"); }}>确认拒绝</Button>
          </div>
        </div>
      </Modal>

      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="合并阶段决策冲突"
        description="服务端阶段草稿或 StagePlan 已变化，原命令不会自动重放。"
        conflictFields={conflict?.fields ?? []}
        comparisons={conflict ? stageConflictComparisons(conflict) : []}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={adoptServerVersion}
        onManualMerge={keepIntentOnLatestRevision}
        mergeLabel="基于最新 revision 保留意图"
      />
    </div>
  );
}

function stageDecisionCommandKey(draftId: string): string {
  return `areaforge.command.stage-decision.${draftId}`;
}

function createStageDecisionCommand(action: StageDecisionAction, draft: StageAdjustmentDraftRecordDto): StageDecisionCommand {
  return {
    action,
    baseRevision: draft.revision,
    firstSubmittedPayload: { expectedRevision: draft.revision },
    firstSubmittedSnapshot: draft,
  };
}

function stageConflictComparisons(conflict: StageDecisionConflict) {
  const local = conflict.command.firstSubmittedSnapshot;
  const latest = conflict.latest;
  return [
    { field: "draft.id", label: "草稿版本", local: local.id, server: latest.draft?.id ?? null },
    { field: "draft.revision", label: "草稿 revision", local: local.revision, server: latest.draft?.revision ?? null },
    { field: "draft.status", label: "草稿状态", local: stageActionStatus(conflict.command.action), server: latest.draft?.status ?? null },
    { field: "draft.originVersion", label: "来源版本", local: local.originVersion, server: latest.draft?.originVersion ?? null },
    { field: "stagePlan.revision", label: "StagePlan revision", local: null, server: latest.stagePlan?.revision ?? null },
  ];
}

function stageActionStatus(action: StageDecisionAction): "applied" | "rejected" {
  return action === "confirm" ? "applied" : "rejected";
}

function isStageAdjustmentConflictLatest(value: unknown): value is StageAdjustmentConflictLatest {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (value as { kind?: unknown }).kind === "stage-adjustment-decision");
}

function isStageDecisionCommand(value: unknown): value is StageDecisionCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Partial<StageDecisionCommand>;
  const payload = command.firstSubmittedPayload as { expectedRevision?: unknown } | undefined;
  const snapshot = command.firstSubmittedSnapshot as Partial<StageAdjustmentDraftRecordDto> | undefined;
  return (command.action === "confirm" || command.action === "reject")
    && typeof command.baseRevision === "number"
    && typeof payload?.expectedRevision === "number"
    && typeof snapshot?.id === "string"
    && typeof snapshot?.revision === "number";
}
