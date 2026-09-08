"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  LockKeyhole,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  TerminalSquare,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  approveControlledOperationRequest,
  cancelControlledOperationRequest,
  confirmControlledOperationRequest,
  createControlledOperationRequest,
  holdControlledOperationRequest,
  listControlledOperationRequests,
  listControlledOperations,
  retryControlledOperationRequest,
  resumeControlledOperationRequest,
  type ControlledOperationCode,
  type ControlledOperationDescriptorView,
  type ControlledOperationIntentInput,
  type ControlledOperationParameters,
  type ControlledOperationRequestStatus,
  type ControlledOperationRequestView,
} from "@/lib/api/controlled-operations";
import { Button } from "@/components/ui/button";
import { Card, SectionCard } from "@/components/ui/card";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/field";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";
import { Metric } from "@/components/ui/metric";
import { formatDateTime } from "@/lib/formatters";
import { isConflict } from "@/lib/client/api-errors";

const DEFAULT_OPERATION: ControlledOperationCode = "DIAGNOSTIC_HEALTH";

export function ControlledOperationsClient(props: {
  enabled: boolean;
  initialOperations?: ControlledOperationDescriptorView[];
  initialRequests?: ControlledOperationRequestView[];
}) {
  const [operations, setOperations] = useState<ControlledOperationDescriptorView[]>(props.initialOperations ?? []);
  const [requests, setRequests] = useState<ControlledOperationRequestView[]>(props.initialRequests ?? []);
  const [operationCode, setOperationCode] = useState<ControlledOperationCode>(DEFAULT_OPERATION);
  const [expectedBeforeHash, setExpectedBeforeHash] = useState("");
  const [requestedReason, setRequestedReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [tag, setTag] = useState("");
  const [backupScope, setBackupScope] = useState<"DATABASE" | "UPLOADS" | "FULL">("FULL");
  const [targetVersion, setTargetVersion] = useState("");
  const [holdReason, setHoldReason] = useState<"RELEASE" | "INCIDENT" | "RESTORE" | "CAPACITY">("INCIDENT");
  const [includeCapacity, setIncludeCapacity] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "success" | "warning" | "danger"; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!props.enabled) return;
    setPending("load");
    const [catalogResult, requestResult] = await Promise.all([
      listControlledOperations(),
      listControlledOperationRequests({ limit: 100 }),
    ]);
    setPending(null);
    if (catalogResult.ok && catalogResult.body?.operations) setOperations(catalogResult.body.operations);
    if (requestResult.ok && requestResult.body?.requests) setRequests(requestResult.body.requests);
    if (!catalogResult.ok || !requestResult.ok) {
      const failed = !catalogResult.ok ? catalogResult : requestResult;
      setNotice({ tone: failed.status === 404 ? "warning" : "danger", text: operationRequestError(failed.status, failed.body?.error) });
    }
  }, [props.enabled]);

  useEffect(() => {
    if (!props.enabled || (props.initialOperations && props.initialRequests)) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, props.enabled, props.initialOperations, props.initialRequests]);

  const selectedDescriptor = operations.find((item) => item.code === operationCode) ?? null;
  const queuedCount = useMemo(() => requests.filter((item) => ["QUEUED", "RUNNING", "PAUSED", "HELD"].includes(item.status)).length, [requests]);
  const approvalCount = useMemo(() => requests.filter((item) => item.status === "CONFIRMATION_REQUIRED" || item.status === "APPROVAL_REQUIRED").length, [requests]);

  if (!props.enabled) {
    return <SectionCard variant="subtle" className="space-y-4"><div className="flex items-start gap-3"><LockKeyhole className="mt-0.5 size-5 shrink-0 text-zinc-500" aria-hidden="true" /><div className="space-y-1"><h2 className="text-base font-semibold text-white">受控运维请求仅对平台 Operator 开放</h2><p className="text-sm leading-6 text-zinc-400">当前账户或环境没有打开 Operator 工作台。Web 不执行服务器命令、备份、migration、部署或回滚。</p></div></div></SectionCard>;
  }

  async function submitIntent() {
    const intent = buildIntent({ operationCode, expectedBeforeHash, requestedReason, idempotencyKey, tag, backupScope, targetVersion, holdReason, includeCapacity });
    if (!intent.ok) {
      setNotice({ tone: "warning", text: intent.error });
      return;
    }
    setPending("create");
    setNotice(null);
    const result = await createControlledOperationRequest(intent.value);
    setPending(null);
    if (!result.ok || !result.body?.request) {
      setNotice({ tone: "danger", text: operationRequestError(result.status, result.body?.error) });
      return;
    }
    setRequests((current) => [result.body!.request!, ...current.filter((item) => item.id !== result.body!.request!.id)]);
    setIdempotencyKey("");
    setNotice({ tone: "success", text: selectedDescriptor?.requiresApproval ? "请求已提交，仍需二次确认和审批；未执行任何服务器动作。" : "只读请求已提交，等待受控 agent 回写状态。" });
  }

  async function mutateRequest(request: ControlledOperationRequestView, action: "confirm" | "approve" | "cancel" | "hold" | "resume" | "retry") {
    const binding = { expectedRevision: request.revision, requestHash: request.requestHash, nonce: request.nonce };
    const requiresExplicitConfirm = request.risk === "HIGH_RISK" && (action === "confirm" || action === "approve" || action === "hold");
    const confirmationText = action === "cancel"
      ? "确认提交取消请求？Web 不会直接终止服务器进程。"
      : action === "retry"
        ? "确认提交安全重试请求？服务端会重新校验 request hash。"
        : "确认推进这个高风险受控请求？这只提交状态，不会由 Web 直接执行服务器动作。";
    if ((action === "cancel" || action === "retry" || requiresExplicitConfirm) && !window.confirm(confirmationText)) return;
    setPending(`${action}:${request.id}`);
    const result = action === "confirm"
      ? await confirmControlledOperationRequest(request.id, binding)
      : action === "approve"
        ? await approveControlledOperationRequest(request.id, binding)
        : action === "cancel"
          ? await cancelControlledOperationRequest(request.id, binding)
          : action === "hold"
            ? await holdControlledOperationRequest(request.id, { ...binding, reasonCode: holdReason })
            : action === "resume"
              ? await resumeControlledOperationRequest(request.id, binding)
              : await retryControlledOperationRequest(request.id, binding);
    setPending(null);
    if (!result.ok || !result.body?.request) {
      setNotice({ tone: "danger", text: operationRequestError(result.status, result.body?.error) });
      if (isConflict(result)) await load();
      return;
    }
    setRequests((current) => current.map((item) => item.id === request.id ? result.body!.request! : item));
    setNotice({ tone: "success", text: requestActionLabel(action) });
  }

  return <div className="space-y-6">
    <Alert tone="warning" title="受控请求边界"><span>这里仅提交白名单 operation intent 与确认绑定。真正的服务器动作只能由 root-only agent 处理；本页面不接受命令文本、脚本、自由路径或环境变量。</span></Alert>
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="请求总数" value={requests.length} note="当前 Operator 可见列表" icon={FileCheck2} tone="accent" layout="tile" /><Metric label="待确认/审批" value={approvalCount} note="需人工继续确认" icon={ClipboardCheck} tone="warning" layout="tile" /><Metric label="队列与运行" value={queuedCount} note="由 agent 回写状态" icon={RefreshCw} tone="info" layout="tile" /><Metric label="执行边界" value="root-only" note="Web 不执行命令" icon={ShieldAlert} tone="danger" layout="tile" /></dl>

    <SectionCard variant="master" className="space-y-5"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4"><div><h2 className="flex items-center gap-2 text-base font-semibold text-white"><TerminalSquare className="size-4 text-teal-300" aria-hidden="true" />提交受控请求</h2><p className="mt-1 text-xs leading-5 text-zinc-400">参数来自 catalog；expected-before、TTL、nonce 和 request hash 由服务端绑定。</p></div><Button disabled={pending !== null} onClick={() => void load()} size="sm" type="button" variant="secondary"><RefreshCw className={`size-3.5 ${pending === "load" ? "animate-spin" : ""}`} aria-hidden="true" />刷新请求</Button></div>
      <fieldset className="grid gap-3 md:grid-cols-2"><legend className="sr-only">受控 operation intent</legend><label className="text-xs text-zinc-300">白名单操作<Select className="mt-2" disabled={pending !== null} value={operationCode} onChange={(event) => setOperationCode(event.target.value as ControlledOperationCode)}>{(operations.length > 0 ? operations : fallbackCatalog).map((operation) => <option key={operation.code} value={operation.code}>{operation.label} · {operation.risk === "HIGH_RISK" ? "高风险" : "只读"}</option>)}</Select></label><label className="text-xs text-zinc-300">expected-before hash<Input className="mt-2 font-mono text-xs" disabled={pending !== null} value={expectedBeforeHash} onChange={(event) => setExpectedBeforeHash(event.target.value)} placeholder="sha256:…" /></label><label className="text-xs text-zinc-300 md:col-span-2">申请理由<Textarea className="mt-2 min-h-20" disabled={pending !== null} value={requestedReason} onChange={(event) => setRequestedReason(event.target.value)} placeholder="说明这次受控请求的窗口、目的和回滚依据" /></label></fieldset>
      <OperationParameterFields operationCode={operationCode} tag={tag} backupScope={backupScope} targetVersion={targetVersion} holdReason={holdReason} includeCapacity={includeCapacity} disabled={pending !== null} onTagChange={setTag} onBackupScopeChange={setBackupScope} onTargetVersionChange={setTargetVersion} onHoldReasonChange={setHoldReason} onIncludeCapacityChange={setIncludeCapacity} />
      <div className="flex flex-wrap items-end gap-3"><label className="min-w-[18rem] flex-1 text-xs text-zinc-300">幂等键（留空自动生成）<Input className="mt-2 font-mono text-xs" disabled={pending !== null} value={idempotencyKey} onChange={(event) => setIdempotencyKey(event.target.value)} placeholder="UUID" /></label><Button disabled={pending !== null} onClick={() => void submitIntent()} type="button"><FileCheck2 className="size-4" aria-hidden="true" />提交受控请求</Button></div>
      {notice ? <Alert tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"}>{notice.text}</Alert> : null}
    </SectionCard>

    <SectionCard variant="subtle" className="space-y-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-white">Operator 请求列表</h2><p className="mt-1 text-xs text-zinc-500">刷新页面不会丢失请求；每个操作都沿着服务端状态机推进。</p></div><Badge tone="info">catalog {operations.length || fallbackCatalog.length} 项</Badge></div>{requests.length === 0 ? <EmptyState title="还没有受控请求" description="选择一个白名单 operation，补齐 expected-before hash 和理由后提交。" /> : <div className="space-y-3">{requests.map((request) => <ControlledRequestRow key={request.id} request={request} pending={pending} holdReason={holdReason} onHoldReasonChange={setHoldReason} onMutate={mutateRequest} />)}</div>}</SectionCard>
  </div>;
}

function OperationParameterFields(props: {
  operationCode: ControlledOperationCode;
  tag: string;
  backupScope: "DATABASE" | "UPLOADS" | "FULL";
  targetVersion: string;
  holdReason: "RELEASE" | "INCIDENT" | "RESTORE" | "CAPACITY";
  includeCapacity: boolean;
  disabled: boolean;
  onTagChange: (value: string) => void;
  onBackupScopeChange: (value: "DATABASE" | "UPLOADS" | "FULL") => void;
  onTargetVersionChange: (value: string) => void;
  onHoldReasonChange: (value: "RELEASE" | "INCIDENT" | "RESTORE" | "CAPACITY") => void;
  onIncludeCapacityChange: (value: boolean) => void;
}) {
  if (props.operationCode === "CHECK_RELEASE" || props.operationCode === "APPLY_RELEASE") return <label className="block text-xs text-zinc-300">{props.operationCode === "CHECK_RELEASE" ? "Release tag（可选）" : "Release tag"}<Input className="mt-2 font-mono text-xs" disabled={props.disabled} value={props.tag} onChange={(event) => props.onTagChange(event.target.value)} placeholder="v1.3.0" /></label>;
  if (props.operationCode === "BACKUP_PREVIEW") return <label className="block text-xs text-zinc-300">预览范围<Select className="mt-2" disabled={props.disabled} value={props.backupScope} onChange={(event) => props.onBackupScopeChange(event.target.value as "DATABASE" | "UPLOADS" | "FULL")}><option value="DATABASE">数据库</option><option value="UPLOADS">上传目录</option><option value="FULL">完整范围</option></Select></label>;
  if (props.operationCode === "ROLLBACK_RELEASE") return <label className="block text-xs text-zinc-300">固定回滚目标<Input className="mt-2 font-mono text-xs" disabled={props.disabled} value={props.targetVersion} onChange={(event) => props.onTargetVersionChange(event.target.value)} placeholder="1.2.0" /></label>;
  if (props.operationCode === "MAINTENANCE_HOLD") return <label className="block text-xs text-zinc-300">维护原因<Select className="mt-2" disabled={props.disabled} value={props.holdReason} onChange={(event) => props.onHoldReasonChange(event.target.value as "RELEASE" | "INCIDENT" | "RESTORE" | "CAPACITY")}><option value="RELEASE">发布</option><option value="INCIDENT">事故</option><option value="RESTORE">恢复</option><option value="CAPACITY">容量</option></Select></label>;
  return <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-zinc-300"><Checkbox checked={props.includeCapacity} disabled={props.disabled} onChange={(event) => props.onIncludeCapacityChange(event.target.checked)} />诊断摘要包含容量指标（仍为脱敏只读）</label>;
}

function ControlledRequestRow(props: {
  request: ControlledOperationRequestView;
  pending: string | null;
  holdReason: "RELEASE" | "INCIDENT" | "RESTORE" | "CAPACITY";
  onHoldReasonChange: (value: "RELEASE" | "INCIDENT" | "RESTORE" | "CAPACITY") => void;
  onMutate: (request: ControlledOperationRequestView, action: "confirm" | "approve" | "cancel" | "hold" | "resume" | "retry") => Promise<void>;
}) {
  const request = props.request;
  const canConfirm = request.status === "PREVIEWED" || request.status === "CONFIRMATION_REQUIRED";
  const canApprove = request.status === "APPROVAL_REQUIRED";
  const canCancel = !["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(request.status);
  const canHold = ["QUEUED", "RUNNING", "PAUSED"].includes(request.status);
  const canResume = ["HELD", "PAUSED"].includes(request.status);
  const canRetry = request.status === "FAILED" && request.retryable;
  return <Card variant="subtle" className="space-y-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="break-all font-mono text-sm text-white">{request.id}</strong><Badge tone={requestStatusTone(request.status)}>{requestStatusLabel(request.status)}</Badge><Badge tone={request.risk === "HIGH_RISK" ? "danger" : "info"}>{request.risk === "HIGH_RISK" ? "高风险" : "只读"}</Badge></div><p className="mt-1 text-sm text-zinc-200">{operationLabel(request.operation)}</p><p className="mt-1 text-xs text-zinc-500">{request.requestedReason} · revision {request.revision} · attempt {request.attempt}</p></div><div className="flex flex-wrap gap-2">{canConfirm ? <Button disabled={props.pending !== null} onClick={() => void props.onMutate(request, "confirm")} size="sm" type="button"><ClipboardCheck className="size-3.5" aria-hidden="true" />确认</Button> : null}{canApprove ? <Button disabled={props.pending !== null} onClick={() => void props.onMutate(request, "approve")} size="sm" type="button"><CheckCircle2 className="size-3.5" aria-hidden="true" />审批</Button> : null}{canCancel ? <Button disabled={props.pending !== null} onClick={() => void props.onMutate(request, "cancel")} size="sm" type="button" variant="secondary"><XCircle className="size-3.5" aria-hidden="true" />取消</Button> : null}{canHold ? <Button disabled={props.pending !== null} onClick={() => void props.onMutate(request, "hold")} size="sm" type="button" variant="secondary"><Pause className="size-3.5" aria-hidden="true" />挂起</Button> : null}{canResume ? <Button disabled={props.pending !== null} onClick={() => void props.onMutate(request, "resume")} size="sm" type="button" variant="secondary"><Play className="size-3.5" aria-hidden="true" />恢复</Button> : null}{canRetry ? <Button disabled={props.pending !== null} onClick={() => void props.onMutate(request, "retry")} size="sm" type="button" variant="secondary"><RefreshCw className="size-3.5" aria-hidden="true" />重试</Button> : null}</div></div><div className="grid gap-2 text-xs text-zinc-500 sm:grid-cols-2"><span>申请时间：{formatDateTime(request.requestedAt)}</span><span>过期时间：{formatDateTime(request.expiresAt)}</span><span className="break-all font-mono">request hash：{request.requestHash}</span><span className="break-all font-mono">expected-before：{request.expectedBeforeHash}</span></div>{canHold ? <label className="block max-w-xs text-xs text-zinc-300">挂起原因<Select className="mt-2" disabled={props.pending !== null} value={props.holdReason} onChange={(event) => props.onHoldReasonChange(event.target.value as "RELEASE" | "INCIDENT" | "RESTORE" | "CAPACITY")}><option value="RELEASE">发布</option><option value="INCIDENT">事故</option><option value="RESTORE">恢复</option><option value="CAPACITY">容量</option></Select></label> : null}{request.failureCode ? <p className="flex items-center gap-2 text-xs text-rose-200"><AlertTriangle className="size-3.5" aria-hidden="true" />{request.failureCode}{request.retryable ? " · 可重试" : ""}</p> : null}{request.status === "SUCCEEDED" ? <p className="flex items-center gap-2 text-xs text-emerald-200"><CheckCircle2 className="size-3.5" aria-hidden="true" />受控 agent 已回写成功；证据摘要：{request.evidenceHash ?? "未提供"}</p> : null}{request.status === "HELD" ? <p className="text-xs text-amber-200">已挂起：{request.holdReasonCode ?? "未说明"}。恢复仍需重新提交绑定。</p> : null}</Card>;
}

function buildIntent(input: {
  operationCode: ControlledOperationCode;
  expectedBeforeHash: string;
  requestedReason: string;
  idempotencyKey: string;
  tag: string;
  backupScope: "DATABASE" | "UPLOADS" | "FULL";
  targetVersion: string;
  holdReason: "RELEASE" | "INCIDENT" | "RESTORE" | "CAPACITY";
  includeCapacity: boolean;
}): { ok: true; value: ControlledOperationIntentInput } | { ok: false; error: string } {
  if (!/^sha256:[0-9a-f]{64}$/.test(input.expectedBeforeHash.trim())) return { ok: false, error: "expected-before hash 必须是 sha256: 加 64 位小写十六进制。" };
  if (!input.requestedReason.trim()) return { ok: false, error: "请填写受控请求理由。" };
  const idempotencyKey = input.idempotencyKey.trim() || createIdempotencyKey();
  const operation = input.operationCode === "CHECK_RELEASE"
    ? { operation: "CHECK_RELEASE" as const, tag: input.tag.trim() || null }
    : input.operationCode === "BACKUP_PREVIEW"
      ? { operation: "BACKUP_PREVIEW" as const, scope: input.backupScope }
      : input.operationCode === "APPLY_RELEASE"
        ? { operation: "APPLY_RELEASE" as const, tag: input.tag.trim() }
        : input.operationCode === "ROLLBACK_RELEASE"
          ? { operation: "ROLLBACK_RELEASE" as const, targetVersion: input.targetVersion.trim() }
          : input.operationCode === "MAINTENANCE_HOLD"
            ? { operation: "MAINTENANCE_HOLD" as const, reasonCode: input.holdReason }
            : { operation: "DIAGNOSTIC_HEALTH" as const, includeCapacity: input.includeCapacity };
  if ((operation.operation === "APPLY_RELEASE" && !operation.tag) || (operation.operation === "ROLLBACK_RELEASE" && !operation.targetVersion)) return { ok: false, error: "请填写该 operation 所需的版本参数。" };
  return { ok: true, value: { operation, expectedBeforeHash: input.expectedBeforeHash.trim(), idempotencyKey, requestedReason: input.requestedReason.trim() } };
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `operator-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function operationLabel(operation: ControlledOperationParameters): string {
  if (operation.operation === "CHECK_RELEASE") return `检查已验证 Release${operation.tag ? ` · ${operation.tag}` : ""}`;
  if (operation.operation === "BACKUP_PREVIEW") return `预览备份计划 · ${operation.scope}`;
  if (operation.operation === "APPLY_RELEASE") return `应用已验证 Release · ${operation.tag}`;
  if (operation.operation === "ROLLBACK_RELEASE") return `回滚到固定目标 · ${operation.targetVersion}`;
  if (operation.operation === "MAINTENANCE_HOLD") return `进入维护屏障 · ${operation.reasonCode}`;
  return `读取脱敏健康摘要 · 容量指标${operation.includeCapacity ? "开启" : "关闭"}`;
}

function requestStatusLabel(status: ControlledOperationRequestStatus): string {
  return { PREVIEWED: "已预览", CONFIRMATION_REQUIRED: "待确认", APPROVAL_REQUIRED: "待审批", QUEUED: "排队中", RUNNING: "运行中", PAUSED: "已暂停", HELD: "已挂起", CANCEL_REQUESTED: "取消中", SUCCEEDED: "成功", FAILED: "失败", CANCELLED: "已取消", EXPIRED: "已过期" }[status];
}

function requestStatusTone(status: ControlledOperationRequestStatus): "neutral" | "info" | "success" | "warning" | "danger" {
  if (status === "SUCCEEDED") return "success";
  if (["FAILED", "EXPIRED"].includes(status)) return "danger";
  if (["CONFIRMATION_REQUIRED", "APPROVAL_REQUIRED", "HELD", "PAUSED"].includes(status)) return "warning";
  if (["QUEUED", "RUNNING", "CANCEL_REQUESTED"].includes(status)) return "info";
  return "neutral";
}

function requestActionLabel(action: "confirm" | "approve" | "cancel" | "hold" | "resume" | "retry"): string {
  return { confirm: "确认已提交。", approve: "审批已提交。", cancel: "取消请求已提交。", hold: "挂起请求已提交。", resume: "恢复请求已提交。", retry: "重试请求已提交。" }[action];
}

function operationRequestError(status: number, error?: string): string {
  if (status === 0) return "网络连接不可用，请刷新请求列表后重试。";
  if (error === "PLATFORM_OPERATOR_NOT_FOUND") return "当前账户不是平台 Operator，受控运维请求保持隐藏。";
  if (error === "CONTROLLED_OPERATION_BINDING_MISMATCH" || error === "CONTROLLED_OPERATION_REVISION_CONFLICT") return "请求已发生状态变化，请刷新后使用最新绑定。";
  if (error === "CONTROLLED_OPERATION_EXPIRED") return "请求已过期，不能继续推进；请重新创建受控请求。";
  if (error === "CONTROLLED_OPERATION_RETRY_NOT_ALLOWED") return "当前状态不允许重试，先刷新确认 agent 回执。";
  if (status === 404) return "受控运维能力未开放，或当前账户无权查看。";
  return error ? `受控请求未完成（${error}），请刷新后重试。` : "受控请求未完成，请刷新后重试。";
}

const fallbackCatalog: ControlledOperationDescriptorView[] = [
  { code: "CHECK_RELEASE", label: "检查已验证 Release", risk: "READ_ONLY", requiresApproval: false, requiresExpectedBefore: true, executionOwner: "ROOT_AGENT" },
  { code: "BACKUP_PREVIEW", label: "预览备份计划", risk: "READ_ONLY", requiresApproval: false, requiresExpectedBefore: true, executionOwner: "ROOT_AGENT" },
  { code: "APPLY_RELEASE", label: "应用已验证 Release", risk: "HIGH_RISK", requiresApproval: true, requiresExpectedBefore: true, executionOwner: "ROOT_AGENT" },
  { code: "ROLLBACK_RELEASE", label: "回滚到固定目标", risk: "HIGH_RISK", requiresApproval: true, requiresExpectedBefore: true, executionOwner: "ROOT_AGENT" },
  { code: "MAINTENANCE_HOLD", label: "进入维护屏障", risk: "HIGH_RISK", requiresApproval: true, requiresExpectedBefore: true, executionOwner: "ROOT_AGENT" },
  { code: "DIAGNOSTIC_HEALTH", label: "读取脱敏健康摘要", risk: "READ_ONLY", requiresApproval: false, requiresExpectedBefore: true, executionOwner: "ROOT_AGENT" },
];
