"use client";

import { useRef, useState } from "react";
import { Alert, Badge } from "@/components/ui/feedback";
import { SectionCard } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { reauthenticate } from "@/lib/api/account";
import { createExclusiveOperationGate } from "@/lib/client/operation-gates";
import { formatDateTime } from "@/lib/formatters";
import { getControlledOperationRequest, type ControlledOperationContextView, type ControlledOperationRequestView, type ControlledOperationEvidenceView } from "@/lib/api/controlled-operations";

export function OperationReauthentication({ disabled }: { disabled: boolean }) {
  const [password, setPassword] = useState(""); const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const gate = useRef(createExclusiveOperationGate());
  async function verify() {
    const token = gate.current.acquire(); if (!token) return;
    const value = password; setPassword(""); setPending(true);
    try {
      const result = await reauthenticate(value);
      setNotice({ ok: result.ok, text: result.ok ? "身份已验证，可以确认和审批运维请求。" : "身份验证未通过，请核对密码后重试。" });
    } finally { gate.current.release(token); setPending(false); }
  }
  return <SectionCard variant="subtle" className="space-y-3">
    <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm text-zinc-300">运维操作的当前密码
      <Input autoComplete="current-password" type="password" className="mt-2" value={password} onChange={event => setPassword(event.target.value)} disabled={disabled || pending} />
    </label><Button className="min-h-11" type="button" disabled={disabled || pending || !password} onClick={() => void verify()}>验证运维身份</Button></div>
    {notice ? <Alert tone={notice.ok ? "success" : "danger"} role={notice.ok ? "status" : "alert"}>{notice.text}</Alert> : null}
  </SectionCard>;
}

export function OperationExecutionContext(props: { context: ControlledOperationContextView | null; status: "ready" | "disabled" | "unavailable" }) {
  const context = props.context;
  if (!context) return <Alert tone={props.status === "disabled" ? "info" : "warning"} title={props.status === "disabled" ? "执行入口默认关闭" : "执行前态暂不可用"}>
    {props.status === "disabled" ? "未绑定的旧请求只能预览，root 执行器不会消费。" : "请由独立执行器刷新脱敏前态后重试；仍可刷新和查看历史请求。"}
  </Alert>;
  return <SectionCard variant="subtle" className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold text-white">已绑定执行前态</h2><Badge tone={context.environment === "local_fixture" ? "info" : "warning"}>{context.environment === "local_fixture" ? "仅本地合成" : "生产目标"}</Badge></div>
    <dl className="grid gap-3 text-sm sm:grid-cols-3">
      <div><dt className="text-zinc-400">当前版本</dt><dd className="mt-1 font-mono text-white">{context.currentVersion}</dd></div>
      <div><dt className="text-zinc-400">已验证候选</dt><dd className="mt-1 font-mono text-white">{context.targetVersion ?? "无候选"}</dd></div>
      <div><dt className="text-zinc-400">固定回滚目标</dt><dd className="mt-1 font-mono text-white">{context.rollbackTargetVersion ?? "不可用"}</dd></div>
    </dl>
    <p className="text-xs leading-5 text-zinc-400">前态更新于 {formatDateTime(context.observedAt)}；确认后不刷新目标、前态或有效期。{context.environment === "local_fixture" ? "所有副作用均为合成模拟，不代表生产交付。" : "实际执行仍受签名、备份和回滚门禁约束。"}</p>
    <details className="min-w-0 text-xs text-zinc-400"><summary className="flex min-h-11 cursor-pointer items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-300">查看不可变镜像与前态指纹</summary>
      <div className="space-y-2 break-all font-mono"><p>current: {context.currentImage ?? "未绑定"}</p><p>target: {context.targetImage ?? "未绑定"}</p><p>rollback: {context.rollbackTargetImage ?? "未绑定"}</p><p>snapshot: {context.snapshotHash}</p></div>
    </details>
  </SectionCard>;
}

export function RequestExecutionEvidence({ request }: { request: ControlledOperationRequestView }) {
  const [events, setEvents] = useState<ControlledOperationEvidenceView[] | null>(null);
  const [error, setError] = useState(false); const [loading, setLoading] = useState(false);
  const gate = useRef(createExclusiveOperationGate());
  async function loadEvidence() {
    const token = gate.current.acquire(); if (!token) return;
    setLoading(true);
    try { const result = await getControlledOperationRequest(request.id); setError(!result.ok); if (result.ok) setEvents(result.body?.evidence ?? []); }
    finally { gate.current.release(token); setLoading(false); }
  }
  if (!request.execution) return <p className="text-xs text-amber-200">旧预览协议 · 未绑定执行身份，不能被 root 执行器消费。</p>;
  const pendingStop = (request.status === "HELD" || request.status === "CANCEL_REQUESTED") && request.workerId !== null;
  return <div className="min-w-0 space-y-2 text-xs leading-5" aria-live="polite">
    <p className="text-zinc-300">{request.execution.environment === "local_fixture" ? "本地合成执行" : "独立 root 执行"} · {request.execution.currentVersion} → {request.execution.targetVersion ?? "只读检查"}</p>
    {request.resultCode?.startsWith("PHASE_") ? <p className="text-teal-200">阶段：{operationPhaseLabel(request.resultCode)}</p> : null}
    {pendingStop ? <Alert tone="warning">等待执行器确认停止。当前租约仍保留，不能恢复或重新领取。</Alert> : null}
    {request.operation.operation === "MAINTENANCE_HOLD" ? <p className="text-amber-200">维护屏障只阻止新的运维领取，不代表既有进程已停止或队列已排空。</p> : null}
    {request.failureCode === "NEEDS_RECONCILIATION" ? <Alert tone="danger">执行结果需要对账。副作用状态不明，已阻止自动重试；请保留执行日志交由操作者核验。</Alert> : null}
    <details className="min-w-0 text-zinc-400"><summary className="flex min-h-11 cursor-pointer items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-300">查看本请求执行绑定</summary>
      <p className="break-all font-mono">{request.execution.bindingHash}</p><p className="mt-1 break-all font-mono">{request.execution.targetImage ?? "本操作不切换镜像"}</p>
    </details>
    <details className="min-w-0 text-zinc-400" onToggle={event => { if (event.currentTarget.open && events === null) void loadEvidence(); }}>
      <summary className="flex min-h-11 cursor-pointer items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-300">阶段证据历史</summary>
      <Button type="button" className="min-h-11" size="sm" variant="secondary" disabled={loading} onClick={() => void loadEvidence()}>刷新阶段证据</Button>
      {error ? <Alert tone="danger">阶段证据读取或校验失败，不能作为执行成功依据。</Alert> : events?.length === 0 ? <p className="mt-2">尚无执行器阶段回执。</p> : null}
      <ol className="mt-3 space-y-2">{events?.map(event => <li key={event.projectionHash} className="min-w-0 rounded-lg border border-white/10 p-3">
        <p className="text-zinc-200">{operationPhaseLabel(`PHASE_${event.phase.toUpperCase()}_${event.state.toUpperCase()}`)} · {formatDateTime(event.recordedAt)}</p>
        <p className="mt-1 break-all font-mono">原始证据：{event.rawEventHash}</p><p className="break-all font-mono">投影指纹：{event.projectionHash}</p>
      </li>)}</ol>
    </details>
  </div>;
}
function operationPhaseLabel(code: string) {
  const match = code.match(/^PHASE_([A-Z]+)_(STARTED|COMPLETE|UNCERTAIN)$/);
  if (!match) return code;
  const phases: Record<string, string> = { ADMISSION: "准入", VALIDATION: "校验", BACKUP: "备份", PREPARE: "准备", MIGRATION: "迁移", SWITCH: "切换", HEALTH: "健康检查", SMOKE: "烟测", ROLLBACK: "回滚", MAINTENANCE: "维护屏障", PREVIEW: "预览", CHECK: "检查", EXECUTION: "受控执行" };
  const states: Record<string, string> = { STARTED: "进行中", COMPLETE: "已完成", UNCERTAIN: "需要对账" };
  return `${phases[match[1]] ?? match[1]} · ${states[match[2]]}`;
}
