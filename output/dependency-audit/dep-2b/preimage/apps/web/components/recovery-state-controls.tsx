"use client";

import { CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import type { TodayDashboardDto } from "@/lib/contracts";
import {
  cancelRecoveryState,
  completeRecoveryState,
  startManualRecovery,
  type RecoveryStateResponse,
} from "@/lib/api/recovery";
import type { ApiResult } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import type { RecoveryStateDto } from "@/lib/contracts";

interface RecoveryStateControlsProps {
  recovery: TodayDashboardDto["recovery"];
}

type RecoveryAction = "start" | "complete" | "cancel";

interface RecoveryCommand {
  action: RecoveryAction;
  label: string;
  run: () => Promise<ApiResult<RecoveryStateResponse>>;
}

interface RecoveryConflict {
  command: RecoveryCommand;
  latest: RecoveryStateDto | null;
  conflictFields: string[];
}

export function RecoveryStateControls({ recovery }: RecoveryStateControlsProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [requestPending, setRequestPending] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [conflict, setConflict] = useState<RecoveryConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);

  async function mutate(command: RecoveryCommand, allowPendingConflict = false) {
    if (conflict && !allowPendingConflict) {
      setConflictOpen(true);
      return;
    }
    setError(null);
    setRequestPending(true);
    try {
      const response = await command.run();
      const body = response.body as (RecoveryStateResponse & {
        latest?: RecoveryStateDto;
        conflictFields?: string[];
      }) | null;

      if (isUnauthorized(response)) {
        setError("登录已过期，当前恢复动作已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        if (isConflict(response)) {
          setConflict({
            command,
            latest: isRecoveryStateDto(body?.latest) ? body.latest : null,
            conflictFields: body?.conflictFields ?? ["status"],
          });
          setConflictOpen(true);
        }
        setError(body?.error ? labelRecoveryError(body.error) : "恢复状态已变化，当前动作已保留；请处理冲突后显式重试。");
        return;
      }

      setConflict(null);
      setConflictOpen(false);
      startTransition(() => router.refresh());
    } catch {
      setError("网络暂时不可用，当前恢复动作已保留；恢复网络后请显式重试。");
    } finally {
      setRequestPending(false);
    }
  }

  function command(action: RecoveryAction): RecoveryCommand | null {
    if (action === "start") return { action, label: "开始恢复", run: startManualRecovery };
    if (!recovery.stateId) return null;
    const exitCondition = action === "complete" ? "首页按钮完成恢复" : "首页按钮取消恢复";
    return {
      action,
      label: action === "complete" ? "完成恢复" : "取消恢复",
      run: () => action === "complete"
        ? completeRecoveryState(recovery.stateId!, exitCondition)
        : cancelRecoveryState(recovery.stateId!, exitCondition),
    };
  }

  function adoptServerVersion() {
    if (!conflict) return;
    const latest = conflict.latest;
    setConflict(null);
    setConflictOpen(false);
    setError(latest
      ? `已采用服务端恢复状态（${latest.status}），原动作没有自动重放。`
      : "服务端没有可采用的恢复状态，请刷新后确认当前状态。");
    startTransition(() => router.refresh());
  }

  function prepareRetry() {
    setConflictOpen(false);
    if (conflict) setError(`已保留“${conflict.command.label}”动作，请点击“保留动作并重试”；系统不会自动重放。`);
  }

  function retryConflict() {
    if (!conflict || requestPending || isPending) return;
    const commandToRetry = conflict.command;
    setConflict(null);
    setConflictOpen(false);
    void mutate(commandToRetry, true);
  }

  function refreshAfterConflict() {
    setConflict(null);
    setConflictOpen(false);
    startTransition(() => router.refresh());
  }

  function conflictFeedback() {
    return <>
      {conflict && !conflictOpen ? <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setConflictOpen(true)}>处理恢复冲突</Button>
        <Button type="button" variant="ghost" size="sm" onClick={retryConflict}>保留动作并重试</Button>
        <Button type="button" variant="ghost" size="sm" onClick={refreshAfterConflict}>刷新状态</Button>
      </div> : null}
      <ConflictResolutionModal
        open={conflictOpen && Boolean(conflict)}
        title="处理恢复状态冲突"
        description="恢复状态已在其他页面或设备变化。当前动作已保留，系统不会自动覆盖或重放。"
        conflictFields={conflict?.conflictFields ?? []}
        comparisons={conflict ? recoveryConflictComparisons(conflict) : []}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={adoptServerVersion}
        onManualMerge={prepareRetry}
        mergeLabel="保留动作并重试"
      />
    </>;
  }

  if (!recovery.active) {
    return (
      <div className="mt-3">
        <Button
          variant="ghost"
          size="lg"
          className="inline-flex h-11 items-center gap-2 rounded-md border border-amber-300/25 px-3 text-sm text-amber-100 hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={requestPending || isPending}
          onClick={() => {
            const next = command("start");
            if (next) void mutate(next);
          }}
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          我需要恢复
        </Button>
        {error ? <p className="mt-2 text-xs text-red-200">{error}</p> : null}
        {conflictFeedback()}
      </div>
    );
  }

  const stateId = recovery.stateId;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          size="lg"
          className="inline-flex h-11 items-center gap-2 rounded-md border border-teal-300/25 px-3 text-sm text-teal-100 hover:bg-teal-300/10 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={requestPending || isPending || !stateId}
          onClick={() => {
            const next = command("complete");
            if (next) void mutate(next);
          }}
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          完成恢复
        </Button>
        <Button
          variant="ghost"
          size="lg"
          className="inline-flex h-11 items-center gap-2 rounded-md border border-zinc-300/20 px-3 text-sm text-zinc-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={requestPending || isPending || !stateId}
          onClick={() => {
            const next = command("cancel");
            if (next) void mutate(next);
          }}
        >
          <XCircle className="h-4 w-4" aria-hidden="true" />
          取消恢复
        </Button>
      </div>
      {error ? <p className="mt-2 text-xs text-red-200">{error}</p> : null}
      {conflictFeedback()}
    </div>
  );
}

function labelRecoveryError(error: string | undefined): string {
  if (error === "RECOVERY_STATE_ALREADY_FINISHED") return "恢复状态已经以另一种终态结束，请刷新后确认当前状态。";
  if (error === "RECOVERY_STATE_NOT_FOUND") return "恢复状态已不存在，请刷新作战台。";
  if (error === "UNAUTHORIZED") return "登录状态已失效，请重新登录。";
  return "恢复状态更新失败，请重试。";
}

function isRecoveryStateDto(value: unknown): value is RecoveryStateDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<RecoveryStateDto>;
  return typeof state.id === "string"
    && (state.status === "active" || state.status === "completed" || state.status === "canceled")
    && typeof state.startedAt === "string";
}

function recoveryConflictComparisons(conflict: RecoveryConflict) {
  return [
    { field: "action", label: "待执行动作", local: conflict.command.label, server: conflict.latest?.status ?? "服务端未返回状态" },
    { field: "status", label: "恢复状态", local: "当前页面状态", server: conflict.latest?.status ?? "未知" },
    { field: "endedAt", label: "结束时间", local: "未读取", server: conflict.latest?.endedAt ?? "未结束" },
  ];
}
