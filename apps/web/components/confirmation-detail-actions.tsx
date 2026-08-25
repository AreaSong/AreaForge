"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import {
  decideConfirmation,
  decideKnowledgeRetestConfirmation,
  type ConfirmationDecisionCommand,
} from "@/lib/api/confirmation";
import { getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import type { ConfirmationActionDto, ConfirmationItemDto } from "@/lib/contracts";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/overlays";

type Decision = "confirm" | "reject";

type ConfirmationMutationCommand =
  | { kind: "decision"; command: ConfirmationDecisionCommand }
  | { kind: "retest"; retestId: string; decision: "confirm" | "void"; input: { idempotencyKey: string; expectedRevision: number } };

interface ConfirmationConflict {
  command: ConfirmationMutationCommand;
  latest: unknown;
  conflictFields: string[];
}

export function ConfirmationDetailActions({ item, sourceHref = item.sourceHref, onCompleted, onNavigate }: { item: ConfirmationItemDto; sourceHref?: string; onCompleted?: () => void | Promise<void>; onNavigate?: () => void }) {
  const router = useRouter();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [pending, setPending] = useState<Decision | "confirm_retest" | "void_retest" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConfirmationConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);

  if (item.status !== "PENDING") {
    return <Alert tone="neutral">该事项已经处理，当前页面只展示冻结结果，不会重复执行。</Alert>;
  }

  const action = item.action;
  if (!action) {
    return <Alert tone="info">该事项需要回到来源页面完成安全确认，确认中心不会伪造缺失的证明参数。</Alert>;
  }
  if (action.kind === "ai_draft") {
    return (
      <section className="space-y-3 border-t border-white/10 pt-5" aria-labelledby="confirmation-action-heading">
        <div>
          <h2 id="confirmation-action-heading" className="text-base font-medium text-zinc-100">处理这项确认</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-500">AI 草稿不能在确认中心直接确认或驳回，必须回到来源页面核对原始结果证明。</p>
        </div>
        <Alert tone="info">
          <span>请在来源页面使用原始 <code>resultProof</code> 完成采用或放弃。</span>{" "}
          <Link href={sourceHref} className="font-medium text-teal-300 underline underline-offset-4" onClick={(event) => {
            if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onNavigate?.();
          }}>打开来源页面</Link>
        </Alert>
      </section>
    );
  }
  const actionable = action;

  async function execute(decision: Decision) {
    if (pending) return;
    setError(null);
    setNotice(null);
    const command = buildConfirmationCommand(actionable, decision);
    if (!command) {
      setError(actionable.kind === "simulation"
        ? "模拟考试只能在结果、复盘和个人反馈完整后确认；如需修改，请回到来源页面。"
        : "AI 草稿必须回到生成它的页面，并使用原始结果证明完成确认。");
      return;
    }
    setPending(decision);
    try {
      const result = await decideConfirmation(command);
      if (isUnauthorized(result)) {
        setError("登录已过期，确认命令已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!result.ok) {
        if (isConflict(result)) {
          setConflict({
            command: { kind: "decision", command },
            latest: result.body?.latest,
            conflictFields: result.body?.conflictFields ?? ["revision", "status"],
          });
          setConflictOpen(true);
        }
        setError(labelConfirmationError(result.body?.error));
        return;
      }
      setNotice(decision === "confirm" ? "已确认并冻结该事项。" : "已驳回该事项，未自动修改正式数据。");
      void onCompleted?.();
      router.refresh();
    } catch {
      setError("网络结果未知。请先刷新确认中心核对状态，再显式重试，不会自动重放命令。");
    } finally {
      setPending(null);
    }
  }

  async function executeRetest(actionName: "confirm_retest" | "void_retest") {
    if (pending || actionable.kind !== "knowledge_retest") return;
    if (!actionable.ready) {
      setError("请先在专项复测页面完成逐点结果、量化分数、个人反馈和复盘。");
      return;
    }
    setError(null);
    setNotice(null);
    setPending(actionName);
    const isConfirm = actionName === "confirm_retest";
    const scope = `knowledge-retest:${actionable.retestId}:${isConfirm ? "confirm" : "void"}`;
    const payload = { expectedRevision: actionable.expectedRevision };
    try {
      const result = await decideKnowledgeRetestConfirmation(
        actionable.retestId,
        isConfirm ? "confirm" : "void",
        {
          idempotencyKey: getOrCreateIdempotencyKey(scope, `knowledge-retest-${isConfirm ? "confirm" : "void"}`, payload),
          ...payload,
        },
      );
      if (isUnauthorized(result)) {
        setError("登录已过期，复测确认命令已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!result.ok) {
        if (isConflict(result)) {
          setConflict({
            command: {
              kind: "retest",
              retestId: actionable.retestId,
              decision: isConfirm ? "confirm" : "void",
              input: {
                idempotencyKey: getOrCreateIdempotencyKey(scope, `knowledge-retest-${isConfirm ? "confirm" : "void"}`, payload),
                ...payload,
              },
            },
            latest: result.body?.latest,
            conflictFields: result.body?.conflictFields ?? ["revision", "status"],
          });
          setConflictOpen(true);
        }
        setError(labelConfirmationError(result.body?.error));
        return;
      }
      setNotice(isConfirm ? "复测已确认，知识点掌握状态已更新。" : "复测已作废，未更新知识点掌握状态。");
      void onCompleted?.();
      router.refresh();
    } catch {
      setError("网络结果未知。请刷新确认中心核对复测状态，再显式重试。");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="space-y-3 border-t border-white/10 pt-5" aria-labelledby="confirmation-action-heading">
      <div>
        <h2 id="confirmation-action-heading" className="text-base font-medium text-zinc-100">处理这项确认</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-500">确认会冻结当前事实；驳回或作废不会静默删除来源记录。</p>
      </div>
      {action.kind === "knowledge_retest" ? (
        <div className="af-action-cluster">
          <Button type="button" variant="primary" size="lg" loading={pending === "confirm_retest"} disabled={pending !== null || !action.ready} onClick={() => void executeRetest("confirm_retest")}>
            <CheckCircle2 size={16} aria-hidden="true" />确认复测并更新掌握
          </Button>
          <Button type="button" variant="danger" size="lg" disabled={pending !== null || !action.ready} onClick={() => setRejectOpen(true)}>
            <XCircle size={16} aria-hidden="true" />作废复测
          </Button>
        </div>
      ) : (
        <div className="af-action-cluster">
          <Button type="button" variant="primary" size="lg" loading={pending === "confirm"} disabled={pending !== null || (action.kind === "simulation" && !action.ready)} onClick={() => void execute("confirm")}>
            <CheckCircle2 size={16} aria-hidden="true" />确认并冻结
          </Button>
          {action.kind === "periodic_report" || action.kind === "stage_adjustment" ? (
            <Button type="button" variant="danger" size="lg" disabled={pending !== null} onClick={() => setRejectOpen(true)}>
              <XCircle size={16} aria-hidden="true" />驳回
            </Button>
          ) : null}
        </div>
      )}
      {action.kind === "simulation" && !action.ready ? <p className="text-sm text-amber-200">请先回到模拟考试详情补齐结果、复盘和个人反馈。</p> : null}
      {action.kind === "knowledge_retest" && !action.ready ? <p className="text-sm text-amber-200">当前复测尚未提交完整结果，请先回到专项复测详情。</p> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Modal open={rejectOpen} title={action.kind === "knowledge_retest" ? "确认作废复测" : "确认不可逆驳回"} onClose={() => setRejectOpen(false)} allowEscape={false}>
        <div className="space-y-4 text-sm text-zinc-300">
          <p>{action.kind === "knowledge_retest" ? "作废后不会更新任何知识点掌握状态；如需检验，之后请重新安排复测。" : "驳回后该建议进入终态，不会自动修改正式计划或阶段。"}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRejectOpen(false)}>取消</Button>
            <Button type="button" variant="danger" loading={pending === "reject" || pending === "void_retest"} onClick={() => {
              setRejectOpen(false);
              if (action.kind === "knowledge_retest") void executeRetest("void_retest");
              else void execute("reject");
            }}>确认处理</Button>
          </div>
        </div>
      </Modal>
      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="处理确认版本冲突"
        description="服务端确认版本已变化。当前命令已保留，系统不会自动覆盖或重放。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={conflict ? confirmationConflictComparisons(conflict) : []}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={() => void adoptConflictServerVersion()}
        onManualMerge={() => void retryConflict()}
        adoptLabel="采用服务端版本"
        mergeLabel="保留命令并重试"
      />
    </section>
  );

  async function adoptConflictServerVersion() {
    if (!conflict) return;
    setConflict(null);
    setConflictOpen(false);
    setError(conflict.latest ? "已采用服务端最新确认状态，原命令未重放。" : "服务端没有可采用版本，已保留原命令；请刷新后再显式重试。");
    router.refresh();
  }

  async function retryConflict() {
    if (!conflict) return;
    const command = conflict.command;
    setConflict(null);
    setConflictOpen(false);
    setError("已保留本地确认命令，正在执行你明确触发的重试。");
    if (command.kind === "decision") {
      await execute(command.command.decision);
      return;
    }
    await executeRetestCommand(command);
  }

  async function executeRetestCommand(command: Extract<ConfirmationMutationCommand, { kind: "retest" }>) {
    if (pending) return;
    setPending(command.decision === "confirm" ? "confirm_retest" : "void_retest");
    try {
      const result = await decideKnowledgeRetestConfirmation(command.retestId, command.decision, command.input);
      if (isUnauthorized(result)) {
        setError("登录已过期，复测确认命令已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!result.ok) {
        if (isConflict(result)) {
          setConflict({
            command,
            latest: result.body?.latest,
            conflictFields: result.body?.conflictFields ?? ["revision", "status"],
          });
          setConflictOpen(true);
        }
        setError(labelConfirmationError(result.body?.error));
        return;
      }
      setNotice(command.decision === "confirm" ? "复测已确认，知识点掌握状态已更新。" : "复测已作废，未更新知识点掌握状态。");
      void onCompleted?.();
      router.refresh();
    } catch {
      setError("网络结果未知。请刷新确认中心核对复测状态，再显式重试。");
    } finally {
      setPending(null);
    }
  }
}

function buildConfirmationCommand(
  action: ConfirmationActionDto,
  decision: Decision,
): ConfirmationDecisionCommand | null {
  if (action.kind === "periodic_report") {
    return {
      ...action,
      decision,
    };
  }
  if (action.kind === "stage_adjustment") {
    return {
      ...action,
      decision,
    };
  }
  if (action.kind === "simulation" && decision === "confirm") {
    return {
      ...action,
      decision,
    };
  }
  return null;
}

function labelConfirmationError(error?: string): string {
  switch (error) {
    case "PERIODIC_REPORT_REVISION_CONFLICT":
    case "PERIODIC_REPORT_DECISION_CONFLICT":
    case "STAGE_ADJUSTMENT_DRAFT_REVISION_CONFLICT":
    case "SIMULATION_EXAM_REVISION_CONFLICT":
    case "KNOWLEDGE_RETEST_CONFIRM_REVISION_CONFLICT":
    case "KNOWLEDGE_RETEST_VOID_REVISION_CONFLICT":
      return "当前版本已经变化，请刷新页面后重新核对。原命令没有自动重放。";
    case "SIMULATION_REVIEW_REQUIRED":
    case "SIMULATION_PERSONAL_FEEDBACK_REQUIRED":
      return "模拟考试的复盘和个人反馈尚未完整，请回来源页面补齐。";
    case "KNOWLEDGE_RETEST_CONFIRM_REQUIRES_REVIEW":
      return "复测还没有完整复盘，不能更新掌握状态。";
    default:
      return error ?? "确认操作失败，请先核对来源页面状态。";
  }
}

function confirmationConflictComparisons(conflict: ConfirmationConflict) {
  const command = conflict.command.kind === "decision" ? conflict.command.command : conflict.command.input;
  const localDecision = conflict.command.kind === "decision" ? conflict.command.command.decision : conflict.command.decision;
  return [
    { field: "revision", label: "本地 revision", local: expectedRevision(command), server: latestRevision(conflict.latest) ?? "无服务端版本" },
    { field: "status", label: "本地命令", local: localDecision, server: readRecord(conflict.latest)?.status ?? "服务端已变化" },
  ];
}

function expectedRevision(command: ConfirmationDecisionCommand | { expectedRevision: number }): number {
  return "expectedRevision" in command ? command.expectedRevision : 0;
}

function latestRevision(value: unknown): number | null {
  const record = readRecord(value);
  const candidates = [record?.revision, readRecord(record?.report)?.revision, readRecord(record?.draft)?.revision];
  return candidates.find((candidate): candidate is number => typeof candidate === "number") ?? null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
