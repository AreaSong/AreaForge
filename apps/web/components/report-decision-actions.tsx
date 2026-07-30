"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { Modal } from "@/components/ui/overlays";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import { selectReportDecisionBaseline } from "@/lib/client/versioned-conflict-baseline";
import type { ReportDecisionConflictLatest } from "@/lib/study/report-decisions-service";
import type {
  PeriodicReportDecisionDto,
  PeriodicReportDto,
} from "@/lib/study/reports-service";

type ReportDecisionAction = "confirm" | "reject";

interface ReportDecisionPayload {
  kind: PeriodicReportDto["kind"];
  expectedRevision: number;
  rangeStart: string;
  rangeEnd: string;
}

interface ReportDecisionCommand {
  action: ReportDecisionAction;
  baseRevision: number;
  firstSubmittedPayload: ReportDecisionPayload;
}

interface ReportDecisionConflict {
  command: ReportDecisionCommand;
  latest: ReportDecisionConflictLatest;
  fields: string[];
}

interface ReportDecisionResponse {
  decision?: PeriodicReportDecisionDto;
  error?: string;
  latest?: unknown;
  conflictFields?: string[];
  workbench?: string;
}

export function ReportDecisionActions({ report }: { report: PeriodicReportDto }) {
  const router = useRouter();
  const [baselineOverride, setBaselineOverride] = useState<PeriodicReportDto | null>(null);
  const [command, setCommand] = useState<ReportDecisionCommand | null>(null);
  const [conflict, setConflict] = useState<ReportDecisionConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isDeciding, setIsDeciding] = useState(false);
  const baseline = selectReportDecisionBaseline(report, baselineOverride);
  const commandKey = reportDecisionCommandKey(baseline.id);
  const decision = baseline.decision;
  const disabled = isPending || isDeciding || Boolean(decision ?? baseline.decision);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const restored = loadPrivateBusinessDraft(commandKey, LONG_PRIVATE_DRAFT_TTL_MS, isReportDecisionCommand);
      if (!restored) return;
      if (baseline.decision?.status === actionStatus(restored.action)) {
        removePrivateBusinessDraft(commandKey);
        return;
      }
      setCommand(restored);
      if (restored.baseRevision !== baseline.revision) {
        setConflict({
          command: restored,
          latest: reportConflictLatest(baseline),
          fields: ["revision"],
        });
        setConflictOpen(true);
        return;
      }
      setNotice("检测到尚未完成的报告决策，请确认当前版本后显式重试。");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [baseline, commandKey]);

  async function decide(action: ReportDecisionAction) {
    if (isDeciding) return;
    if (conflict) {
      setConflictOpen(true);
      return;
    }
    setError(null);
    setNotice(null);
    const activeCommand = command?.action === action && command.baseRevision === baseline.revision
      ? command
      : createReportCommand(action, baseline);
    setCommand(activeCommand);
    savePrivateBusinessDraft(commandKey, activeCommand);
    setIsDeciding(true);
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(baseline.id)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(activeCommand.firstSubmittedPayload),
      });
      const body = (await response.json().catch(() => null)) as ReportDecisionResponse | null;
      if (response.status === 401) {
        setError("登录已过期，报告决策命令已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        if (response.status === 409 && isReportDecisionConflictLatest(body?.latest)) {
          setConflict({ command: activeCommand, latest: body.latest, fields: body.conflictFields ?? [] });
          setConflictOpen(true);
        }
        setError(labelDecisionError(body?.error));
        if (response.status === 404 && body?.workbench) router.push(body.workbench);
        return;
      }

      removePrivateBusinessDraft(commandKey);
      setCommand(null);
      if (body?.decision) setBaselineOverride({ ...baseline, decision: body.decision });
      const inbox = body?.decision?.inboxResult;
      const counts = inbox ? `入箱新增 ${inbox.createdCount}，复用 ${inbox.reusedCount}，替代 ${inbox.supersededCount}` : "";
      setNotice(body?.decision?.alreadyDecided
        ? "该周期报告已经处理，正在刷新回放。"
        : action === "confirm" ? `报告已冻结，${counts}；阶段建议仍需独立确认。` : "报告版本已不可逆驳回。");
      startTransition(() => router.refresh());
    } catch {
      setError("网络结果未知，报告决策命令已保留；恢复网络后请先核对服务端状态，再显式重试。");
    } finally {
      setIsDeciding(false);
    }
  }

  function adoptServerVersion() {
    if (!conflict) return;
    removePrivateBusinessDraft(commandKey);
    setCommand(null);
    setBaselineOverride(conflict.latest.report);
    setConflict(null);
    setConflictOpen(false);
    setError(null);
    setNotice("已采用服务端版本，原命令未重放。");
    startTransition(() => router.refresh());
  }

  function keepIntentOnLatestRevision() {
    if (!conflict) return;
    const latest = conflict.latest.report;
    const next = createReportCommand(conflict.command.action, latest);
    const nextCommandKey = reportDecisionCommandKey(latest.id);
    if (nextCommandKey !== commandKey) removePrivateBusinessDraft(commandKey);
    savePrivateBusinessDraft(nextCommandKey, next);
    setCommand(next);
    setBaselineOverride(latest);
    setConflict(null);
    setConflictOpen(false);
    setError(null);
    setNotice("已基于服务端最新版本保留决策意图，请检查后显式重试。");
    startTransition(() => router.refresh());
  }

  return (
    <div className="mt-4 rounded-md border border-white/10 bg-[#151a20] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-100">报告决策</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            确认会冻结快照、原子加入全部计划草稿，并生成独立的阶段建议；不会修改现有任务或 StagePlan。
          </p>
        </div>
        {decision ? (
          <span className="w-fit rounded-md border border-teal-300/20 px-2 py-1 text-xs text-teal-100">
            {decision.status === "confirmed" ? "已确认" : "已驳回"}
          </span>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-teal-400 px-3 text-sm font-medium text-[#071011] disabled:cursor-not-allowed disabled:opacity-60" disabled={disabled} onClick={() => void decide("confirm")} type="button">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />确认本报告
            </button>
            <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-rose-300/30 px-3 text-sm font-medium text-rose-100 hover:bg-rose-300/10 disabled:cursor-not-allowed disabled:opacity-60" disabled={disabled} onClick={() => setRejectConfirmOpen(true)} type="button">
              <XCircle className="h-4 w-4" aria-hidden="true" />驳回本报告
            </button>
          </div>
        )}
      </div>

      {decision ? (
        <div className="mt-3 grid gap-2 border-t border-white/10 pt-3 text-xs leading-5 text-zinc-400">
          <p>处理时间：{new Date(decision.decidedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>
          <p>冻结短板：{decision.reportSnapshot.weakness.title}</p>
          <p>确认边界：{decision.canAutoApply ? "可自动应用" : "不自动应用"} / {decision.requiresUserConfirmation ? "需确认" : "无需确认"}</p>
          <p>收件箱：新增 {decision.inboxResult.createdCount}，替代 {decision.inboxResult.supersededCount}</p>
          {decision.nextCycleDraft ? <p>下周期草稿：{decision.nextCycleDraft.focus}</p> : null}
          {decision.inboxResult.createdCount > 0 ? <Link className="w-fit text-teal-300" href="/today/inbox">查看收件箱</Link> : null}
          {decision.stageDraftId ? <Link className="w-fit text-teal-300" href="/stage/overview">查看阶段建议</Link> : null}
          {decision.status === "rejected" ? <Link className="w-fit text-teal-300" href="/stage/overview">前往阶段概览重新评估</Link> : null}
        </div>
      ) : null}

      {notice ? <p role="status" className="mt-3 text-xs text-teal-100">{notice}</p> : null}
      {error ? <p role="alert" className="mt-3 text-xs text-red-200">{error}</p> : null}

      <Modal open={rejectConfirmOpen} title="确认不可逆驳回" onClose={() => setRejectConfirmOpen(false)} allowEscape={false}>
        <div className="space-y-4 text-sm text-zinc-300">
          <p>驳回后当前周期决策进入终态，不能恢复、确认或再次驳回。重新评估必须生成新版本。</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="h-10 rounded-md border border-white/10 px-3" onClick={() => setRejectConfirmOpen(false)}>取消</button>
            <button type="button" className="h-10 rounded-md bg-rose-500 px-3 font-medium text-white" onClick={() => { setRejectConfirmOpen(false); void decide("reject"); }}>确认驳回</button>
          </div>
        </div>
      </Modal>

      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="合并报告决策冲突"
        description="服务端报告或决策状态已变化，原命令不会自动重放。"
        conflictFields={conflict?.fields ?? []}
        comparisons={conflict ? reportConflictComparisons(conflict) : []}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={adoptServerVersion}
        onManualMerge={keepIntentOnLatestRevision}
        mergeLabel="基于最新版本保留意图"
      />
    </div>
  );
}

function reportDecisionCommandKey(reportId: string): string {
  return `areaforge.command.report-decision.${reportId}`;
}

function createReportCommand(action: ReportDecisionAction, report: PeriodicReportDto): ReportDecisionCommand {
  return {
    action,
    baseRevision: report.revision,
    firstSubmittedPayload: {
      kind: report.kind,
      expectedRevision: report.revision,
      rangeStart: report.range.start,
      rangeEnd: report.range.end,
    },
  };
}

function reportConflictLatest(report: PeriodicReportDto): ReportDecisionConflictLatest {
  return { kind: "periodic-report-decision", report, decision: report.decision };
}

function reportConflictComparisons(conflict: ReportDecisionConflict) {
  const payload = conflict.command.firstSubmittedPayload;
  const latest = conflict.latest;
  return [
    { field: "revision", label: "报告 revision", local: payload.expectedRevision, server: latest.report.revision },
    { field: "range.start", label: "周期开始", local: payload.rangeStart, server: latest.report.range.start },
    { field: "range.end", label: "周期结束", local: payload.rangeEnd, server: latest.report.range.end },
    { field: "decision.status", label: "决策状态", local: actionStatus(conflict.command.action), server: latest.decision?.status ?? "未决策" },
  ];
}

function actionStatus(action: ReportDecisionAction): "confirmed" | "rejected" {
  return action === "confirm" ? "confirmed" : "rejected";
}

function isReportDecisionConflictLatest(value: unknown): value is ReportDecisionConflictLatest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const latest = value as Partial<ReportDecisionConflictLatest>;
  return latest.kind === "periodic-report-decision" && Boolean(latest.report && typeof latest.report === "object");
}

function isReportDecisionCommand(value: unknown): value is ReportDecisionCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Partial<ReportDecisionCommand>;
  const payload = command.firstSubmittedPayload as Partial<ReportDecisionPayload> | undefined;
  return (command.action === "confirm" || command.action === "reject")
    && typeof command.baseRevision === "number"
    && Boolean(payload)
    && (payload?.kind === "week" || payload?.kind === "month")
    && typeof payload?.expectedRevision === "number"
    && typeof payload?.rangeStart === "string"
    && typeof payload?.rangeEnd === "string";
}

function labelDecisionError(error?: string): string {
  switch (error) {
    case "PERIODIC_REPORT_DECISION_CONFLICT":
      return "该周期报告已经做过相反决策，不能静默覆盖。";
    case "PERIODIC_REPORT_RANGE_STALE":
    case "PERIODIC_REPORT_REVISION_CONFLICT":
      return "页面中的报告版本已过期，请处理冲突后再决定。";
    case "UNAUTHORIZED":
      return "请先登录后再处理报告。";
    default:
      return error ?? "报告决策失败。";
  }
}
