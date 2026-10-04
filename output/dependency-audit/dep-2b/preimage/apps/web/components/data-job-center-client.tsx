"use client";

import {
  AlertCircle,
  CheckCircle2,
  Download,
  Eye,
  FileArchive,
  PauseCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dataJobQuotaErrorText } from "@/lib/api/data-job-quota-errors";
import {
  cancelDataLifecycleJob,
  createExportDownloadGrant,
  listDataLifecycleJobs,
  previewDataLifecycle,
  requestDataLifecycleJob,
  revokeExportDownloadGrants,
  retryDataLifecycleJob,
  pauseDataLifecycleJob,
  resumeDataLifecycleJob,
  redeemExportDownloadGrant,
  type DataDeletePreviewView,
  type DataExportPreviewView,
  type DataJobKind,
  type DataJobScope,
  type DataJobStatus,
  type DataJobView,
} from "@/lib/api/data-lifecycle";
import { formatDateTime } from "@/lib/formatters";
import { isConflict } from "@/lib/client/api-errors";
import { createExclusiveOperationGate, createLatestOperationGate, type OperationToken } from "@/lib/client/operation-gates";
import { saveDataExportBlob } from "@/lib/client/data-export-download";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, SectionCard } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";
import { Metric } from "@/components/ui/metric";

export interface DataJobWorkspaceOption {
  id: string;
  name: string;
  role?: string;
}

export function DataJobCenterClient(props: {
  enabled: boolean;
  exportEnabled?: boolean;
  workspaces?: DataJobWorkspaceOption[];
  initialJobs?: DataJobView[];
}) {
  const [jobs, setJobs] = useState<DataJobView[]>(props.initialJobs ?? []);
  const [preview, setPreview] = useState<DataExportPreviewView | DataDeletePreviewView | null>(null);
  const [kind, setKind] = useState<DataJobKind>("EXPORT");
  const [scope, setScope] = useState<DataJobScope>("ACCOUNT");
  const [workspaceId, setWorkspaceId] = useState("");
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "success" | "warning" | "danger"; text: string } | null>(null);
  const requestGate = useRef(createLatestOperationGate());
  const actions = useRef(createExclusiveOperationGate());
  const busy = useRef<string | null>(null);
  const alive = useRef(true);
  const downloadAbort = useRef<AbortController | null>(null);
  const requestIdentity = useRef<{ form: string; key: string } | null>(null);
  const formKey = JSON.stringify({ kind, scope, workspaceId: scope === "WORKSPACE" ? workspaceId : null });

  const refresh = useCallback(async (quiet = false) => {
    if (!props.enabled || !alive.current || busy.current !== null) return;
    const token = requestGate.current.begin();
    if (!quiet) { busy.current = "refresh"; setPending("refresh"); }
    const result = await listDataLifecycleJobs();
    if (!requestGate.current.isCurrent(token)) return;
    requestGate.current.finish(token);
    if (!quiet) { busy.current = null; setPending(null); }
    if (result.ok && result.body?.jobs) {
      setJobs(result.body.jobs);
      setRefreshError(null);
      return;
    }
    setRefreshError(`${dataRequestError(result.status, result.body?.error)} 正在显示上次取得的状态。`);
  }, [props.enabled]);

  useEffect(() => {
    alive.current = props.enabled;
    if (!props.enabled) return;
    const refreshGate = requestGate.current;
    const mutationGate = actions.current;
    const timer = window.setTimeout(() => void refresh(), 0);
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(true); }, 3_000);
    return () => { window.clearTimeout(timer); window.clearInterval(poll); alive.current = false; refreshGate.invalidate(); mutationGate.invalidate(); downloadAbort.current?.abort(); busy.current = null; };
  }, [props.enabled, refresh]);

  const previewMatchesForm = preview?.scope === scope && previewKey === formKey && (kind === "EXPORT") === (preview !== null && isExportPreview(preview));
  const activeCount = useMemo(
    () => jobs.filter((job) => !isTerminalJob(job.status) || (job.status === "FAILED" && job.retryable && !!job.nextAttemptAt)).length,
    [jobs],
  );
  const completedCount = useMemo(
    () => jobs.filter((job) => job.kind === "EXPORT" && job.queueVersion === 1 && job.status === "SUCCEEDED").length,
    [jobs],
  );

  if (!props.enabled) {
    return (
      <SectionCard variant="subtle" className="space-y-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-zinc-500" aria-hidden="true" />
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-white">数据任务中心尚未启用</h2>
            <p className="text-sm leading-6 text-zinc-400">
              当前环境没有开放数据生命周期能力。现有导入/导出入口仍按原有鉴权边界工作；这里不会创建任务、归档文件或执行删除。
            </p>
          </div>
        </div>
      </SectionCard>
    );
  }

  function beginAction(key: string): OperationToken | null {
    if (!alive.current || busy.current !== null) return null;
    const token = actions.current.acquire();
    if (!token) return null;
    requestGate.current.invalidate(); busy.current = key; setPending(key); setNotice(null);
    return token;
  }

  function finishAction(token: OperationToken): boolean {
    if (!actions.current.release(token)) return false;
    busy.current = null; setPending(null); return true;
  }

  async function runPreview() {
    if (scope === "WORKSPACE" && !workspaceId) { setNotice({ tone: "warning", text: "请选择工作区后再预览。" }); return; }
    const token = beginAction("preview"); if (!token) return;
    const captured = { kind, scope, workspaceId, key: formKey };
    try {
      const result = await previewDataLifecycle(captured.kind, captured.scope, captured.scope === "WORKSPACE" ? captured.workspaceId : undefined);
      if (!actions.current.isActive(token)) return;
      if (!result.ok || !result.body?.preview) { setNotice({ tone: "danger", text: dataRequestError(result.status, result.body?.error) }); return; }
      setPreview(result.body.preview); setPreviewKey(captured.key);
      setNotice({ tone: "info", text: "预览仅说明范围；导出内容以后台生成时的快照为准。" });
    } finally { finishAction(token); }
  }

  async function createJob() {
    if (!previewMatchesForm || (kind === "EXPORT" && !props.exportEnabled)) return;
    const token = beginAction("create"); if (!token) return;
    const captured = { kind, scope, workspaceId, form: formKey };
    if (requestIdentity.current?.form !== captured.form) requestIdentity.current = { form: captured.form, key: createDataIdempotencyKey() };
    const idempotencyKey = requestIdentity.current.key;
    try {
      const result = await requestDataLifecycleJob({ kind: captured.kind, scope: captured.scope,
        workspaceId: captured.scope === "WORKSPACE" ? captured.workspaceId : undefined, idempotencyKey });
      if (!actions.current.isActive(token)) return;
      if (!result.ok || !result.body?.job) {
        if (["DATA_EXPORT_AUTHORIZATION_CHANGED", "DATA_EXPORT_IDEMPOTENCY_CONFLICT"].includes(result.body?.error ?? "")) {
          requestIdentity.current = null; setPreview(null); setPreviewKey(null);
        }
        setNotice({ tone: "danger", text: dataRequestError(result.status, result.body?.error) }); return;
      }
      const job = result.body.job; setJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
      requestIdentity.current = null; setPreview(null); setPreviewKey(null);
      setNotice({ tone: "success", text: captured.kind === "DELETE" ? "删除影响预览已保存，不会执行删除。" : "导出已排队，状态会自动刷新。" });
    } finally { finishAction(token); }
  }

  async function mutateJob(job: DataJobView, action: "cancel" | "retry" | "pause" | "resume") {
    if (busy.current !== null) return;
    if (action === "cancel" && !window.confirm("确认取消此任务？运行中的任务将先收到取消请求。")) return;
    if (action === "retry" && !window.confirm("确认重试？服务端会重新校验，过期或撤销的权限不会恢复。")) return;
    const token = beginAction(`${action}:${job.id}`); if (!token) return;
    let reload = false;
    try {
      const methods = { cancel: cancelDataLifecycleJob, retry: retryDataLifecycleJob, pause: pauseDataLifecycleJob, resume: resumeDataLifecycleJob };
      const result = await methods[action](job.id, job.revision);
      if (!actions.current.isActive(token)) return;
      if (!result.ok || !result.body?.job) { reload = isConflict(result); setNotice({ tone: "danger", text: dataRequestError(result.status, result.body?.error) }); return; }
      replaceJob(result.body.job); setNotice({ tone: "success", text: "操作请求已提交，以服务端状态为准。" });
    } finally { if (finishAction(token) && reload) void refresh(true); }
  }

  async function issueGrant(job: DataJobView) {
    const token = beginAction(`download:${job.id}`); if (!token) return;
    const controller = new AbortController(); downloadAbort.current = controller;
    setNotice({ tone: "info", text: "正在校验文件并获取一次性下载授权，请勿重复提交。" });
    try {
      const issued = await createExportDownloadGrant(job.id);
      if (!actions.current.isActive(token)) return;
      if (!issued.ok || !issued.body?.grant) { setNotice({ tone: "danger", text: dataRequestError(issued.status, issued.body?.error) }); return; }
      const result = await redeemExportDownloadGrant(issued.body.grant.token, controller.signal);
      if (!actions.current.isActive(token)) return;
      if (!result.ok || !result.blob || !result.fileName) {
        setNotice({ tone: "danger", text: `${dataRequestError(result.status, result.body?.error)} 下载授权可能已消费，可重新获取。` }); return;
      }
      saveDataExportBlob(result.blob, result.fileName);
      setNotice({ tone: "success", text: "文件已交给浏览器保存；若保存被取消，可再次点击下载重新获取授权。" });
    } catch {
      if (actions.current.isActive(token)) setNotice({ tone: "danger", text: "浏览器未能开始保存；授权可能已消费，请重新获取后重试。" });
    } finally {
      if (downloadAbort.current === controller) downloadAbort.current = null;
      finishAction(token);
    }
  }

  async function revokeGrant(job: DataJobView) {
    if (busy.current !== null || !window.confirm("确认撤销尚未开始使用的下载授权？已交付的文件无法收回。")) return;
    const token = beginAction(`revoke:${job.id}`); if (!token) return;
    try {
      const result = await revokeExportDownloadGrants(job.id);
      if (!actions.current.isActive(token)) return;
      setNotice(result.ok ? { tone: "success", text: `已撤销 ${result.body?.revokedCount ?? 0} 个未消费授权。` }
        : { tone: "danger", text: dataRequestError(result.status, result.body?.error) });
    } finally { finishAction(token); }
  }

  function changeForm() { requestIdentity.current = null; setPreview(null); setPreviewKey(null); }

  function replaceJob(job: DataJobView) {
    setJobs(current => current.map(item => item.id === job.id ? job : item));
  }

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="待处理任务" value={activeCount} note="服务端状态" icon={RefreshCw} tone="info" layout="tile" />
        <Metric label="已生成归档" value={completedCount} note="仅统计当前列表" icon={CheckCircle2} tone="success" layout="tile" />
        <Metric label="删除执行" value="未开放" note="仅预览与冷静期" icon={Trash2} tone="warning" layout="tile" />
        <Metric label="Web 边界" value="受控" note="不执行服务器命令" icon={ShieldCheck} tone="accent" layout="tile" />
      </dl>

      <SectionCard variant="master" className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-white"><FileArchive className="size-4 text-teal-300" aria-hidden="true" />创建数据任务</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-400">先看范围摘要，再提交一个可追踪的导出或删除预览任务。</p>
          </div>
          <Button disabled={pending !== null} onClick={() => void refresh()} size="sm" type="button" variant="secondary"><RefreshCw className={`size-3.5 ${pending === "refresh" ? "animate-spin" : ""}`} aria-hidden="true" />刷新任务</Button>
        </div>

        <fieldset className="grid gap-3 md:grid-cols-3">
          <legend className="sr-only">数据任务范围和类型</legend>
          <label className="text-xs text-zinc-300">任务类型<Select aria-label="任务类型" className="mt-2" disabled={pending !== null} value={kind} onChange={(event) => { setKind(event.target.value as DataJobKind); changeForm(); }}><option value="EXPORT">导出（本人数据与附件）</option><option value="DELETE">删除预览（不执行删除）</option></Select></label>
          <label className="text-xs text-zinc-300">范围<Select aria-label="范围" className="mt-2" disabled={pending !== null} value={scope} onChange={(event) => { setScope(event.target.value as DataJobScope); changeForm(); }}><option value="ACCOUNT">当前账户</option><option value="WORKSPACE">指定工作区</option></Select></label>
          {scope === "WORKSPACE" ? <label className="text-xs text-zinc-300">工作区<Select aria-label="工作区" className="mt-2" disabled={pending !== null} value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); changeForm(); }}><option value="">选择工作区</option>{(props.workspaces ?? []).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</Select></label> : <div className="hidden md:block" aria-hidden="true" />}
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <Button disabled={pending !== null} onClick={() => void runPreview()} size="lg" type="button" variant="secondary"><Eye className="size-4" aria-hidden="true" />生成范围预览</Button>
          <Button disabled={pending !== null || !previewMatchesForm || (kind === "EXPORT" && !props.exportEnabled)} onClick={() => void createJob()} size="lg" type="button"><FileArchive className="size-4" aria-hidden="true" />{kind === "DELETE" ? "创建删除预览任务" : "创建导出任务"}</Button>
        </div>

        {notice ? <Alert tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"}>{notice.text}</Alert> : null}
        {preview ? <PreviewPanel preview={preview} /> : <p className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-xs text-zinc-500">尚未生成预览；不会在后台猜测范围。</p>}
        {!props.exportEnabled ? <Alert tone="warning">完整导出尚未开启；可查看范围预览，不会创建归档文件。</Alert> : null}
        {refreshError ? <Alert tone="warning" role="status">{refreshError}</Alert> : null}
      </SectionCard>

      <SectionCard variant="subtle" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-base font-semibold text-white">任务回执</h2><p className="mt-1 text-xs text-zinc-500">每一行都来自服务端任务 DTO；过期、冲突或权限变化会明确提示。</p></div>
          <Badge tone="info">最多显示 100 条</Badge>
        </div>
        {jobs.length === 0 ? <EmptyState title="还没有数据任务" description="生成预览后提交第一项导出或删除预览，系统会保留可追踪的状态回执。" /> : <div className="space-y-3">{jobs.map((job) => <DataJobRow key={job.id} job={job} pending={pending} onMutate={mutateJob} onGrant={issueGrant} onRevokeGrant={revokeGrant} />)}</div>}
      </SectionCard>
    </div>
  );
}

function PreviewPanel({ preview }: { preview: DataExportPreviewView | DataDeletePreviewView }) {
  if (isExportPreview(preview)) {
    return <Card variant="subtle" className="space-y-3"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Eye className="size-4 text-sky-300" aria-hidden="true" />导出范围预览</CardTitle></CardHeader><CardContent className="space-y-3 pt-0"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="对象" value={preview.recordCount} layout="compact" valueSize="base" /><Metric label="附件" value={preview.attachmentCount} layout="compact" valueSize="base" /><Metric label="脱敏字段" value={preview.omittedFieldCount} layout="compact" valueSize="base" /><Metric label="包状态" value="未创建" layout="compact" valueSize="base" tone="warning" /></div><p className="break-all font-mono text-[11px] text-zinc-500">manifest {preview.manifestSha256}</p><div className="rounded-xl border border-white/10 bg-black/10 p-3"><p className="text-xs font-medium text-zinc-300">对象摘要（前 8 条）</p><ul aria-label="脱敏对象摘要" className="mt-2 space-y-1.5 text-[11px] text-zinc-500">{preview.entries.slice(0, 8).map((entry) => <li className="flex flex-wrap gap-x-2 gap-y-1" key={`${entry.kind}:${entry.id}`}><span className="text-zinc-300">{entry.kind}</span><span className="break-all">{entry.id}</span><span className="font-mono">{entry.sha256}</span><span>省略 {entry.omittedFieldCount} 项</span></li>)}</ul>{preview.entries.length > 8 ? <p className="mt-2 text-[11px] text-zinc-500">其余 {preview.entries.length - 8} 条仅计入 manifest，不在页面展开。</p> : null}</div><p className="text-xs text-zinc-400">这是范围摘要，不包含正文；归档由独立 worker 写入，内容以生成时快照为准。</p></CardContent></Card>;
  }
  return <Card variant="subtle" className="space-y-3 border-amber-300/20"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Trash2 className="size-4 text-amber-300" aria-hidden="true" />删除影响预览</CardTitle></CardHeader><CardContent className="space-y-3 pt-0"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="对象" value={preview.totalObjects} layout="compact" valueSize="base" /><Metric label="冷静期至" value={formatDateTime(preview.cooldownUntil)} layout="compact" valueSize="sm" /><Metric label="物理删除" value="未支持" layout="compact" valueSize="base" tone="warning" /><Metric label="执行状态" value="仅预览" layout="compact" valueSize="base" tone="warning" /></div><p className="break-all font-mono text-[11px] text-zinc-500">scope {preview.scopeHash}</p>{preview.rankingBlockerCount !== undefined ? <p className="text-xs text-zinc-300">排名联动：{preview.rankingBlockerCount} 个未解散挑战、{preview.rankingParticipationCount ?? 0} 条参与记录、{preview.rankingProjectionCount ?? 0} 条投影待处理。</p> : null}<p className="text-xs leading-5 text-amber-100">当前实现不会物理删除数据库、附件或备份，也不会把预览当作授权。以下阻塞项由服务端返回：</p><ul className="list-disc space-y-1 pl-5 text-xs text-zinc-400">{preview.blockers.map((blocker) => <li key={blocker}>{deleteBlockerLabel(blocker)}</li>)}</ul></CardContent></Card>;
}

function DataJobRow(props: {
  job: DataJobView;
  pending: string | null;
  onMutate: (job: DataJobView, action: "cancel" | "retry" | "pause" | "resume") => Promise<void>;
  onGrant: (job: DataJobView) => Promise<void>;
  onRevokeGrant: (job: DataJobView) => Promise<void>;
}) {
  const { job } = props;
  const durable = job.queueVersion === 1;
  const expired = job.exportState === "EXPIRED" || job.status === "EXPIRED";
  const canCancel = !expired && ["QUEUED", "RUNNING", "PAUSED", "CANCEL_REQUESTED", "FAILED"].includes(job.status);
  const canRetry = !expired && job.kind === "EXPORT" && job.status === "FAILED" && (durable || job.retryable);
  const canPause = !expired && durable && !job.deadLetteredAt && ["QUEUED", "RUNNING", "FAILED"].includes(job.status) && !job.pauseRequested;
  const canResume = !expired && durable && job.status === "PAUSED";
  const canDownload = durable && job.downloadable === true && job.exportState === "READY";
  const progress = Math.max(0, Math.min(100, Math.round(job.progress * 100)));
  const waiting = job.status === "FAILED" && job.retryable && !!job.nextAttemptAt && !job.deadLetteredAt;
  const label = expired ? "已过期" : job.pauseRequested ? "暂停请求中" : waiting ? "等待自动重试" : statusLabel(job.status);
  return <Card variant="subtle" className="space-y-3" data-job-id={job.id}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><strong className="break-all font-mono text-sm text-white">{job.id}</strong><Badge tone={waiting ? "warning" : statusTone(job.status)}>{label}</Badge><Badge tone="neutral">{job.kind === "EXPORT" ? "导出" : "删除预览"} · {job.scope === "ACCOUNT" ? "账户" : "工作区"}</Badge>{!durable ? <Badge tone="neutral">预览协议</Badge> : null}</div>
        <p className="mt-1 text-xs text-zinc-500">创建于 {formatDateTime(job.createdAt)} · 第 {job.attempt} 次尝试</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {canCancel ? <Button className="min-h-11 sm:min-h-8" disabled={props.pending !== null} onClick={() => void props.onMutate(job, "cancel")} size="sm" type="button" variant="secondary"><XCircle className="size-3.5" aria-hidden="true" />取消</Button> : null}
        {canPause ? <Button className="min-h-11 sm:min-h-8" disabled={props.pending !== null} onClick={() => void props.onMutate(job, "pause")} size="sm" type="button" variant="secondary"><PauseCircle className="size-3.5" aria-hidden="true" />暂停</Button> : null}
        {canResume ? <Button className="min-h-11 sm:min-h-8" disabled={props.pending !== null} onClick={() => void props.onMutate(job, "resume")} size="sm" type="button" variant="secondary">恢复</Button> : null}
        {canRetry ? <Button className="min-h-11 sm:min-h-8" disabled={props.pending !== null} onClick={() => void props.onMutate(job, "retry")} size="sm" type="button" variant="secondary"><RefreshCw className="size-3.5" aria-hidden="true" />重试</Button> : null}
        {canDownload ? <Button className="min-h-11 sm:min-h-8" disabled={props.pending !== null} onClick={() => void props.onGrant(job)} size="sm" type="button"><Download className="size-3.5" aria-hidden="true" />{props.pending === `download:${job.id}` ? "校验并下载…" : "下载 ZIP"}</Button> : null}
        {job.kind === "EXPORT" && job.status === "SUCCEEDED" ? <Button className="min-h-11 sm:min-h-8" disabled={props.pending !== null} onClick={() => void props.onRevokeGrant(job)} size="sm" type="button" variant="secondary">撤销下载授权</Button> : null}
      </div>
    </div>
    <div className="space-y-1"><div className="flex items-center justify-between text-[11px] text-zinc-500"><span>处理阶段</span><span>{progress}%</span></div><progress aria-label={`${job.id} 服务端进度`} className="h-2 w-full accent-teal-400" max={100} value={progress} /></div>
    {job.nextAttemptAt && waiting ? <p className="text-xs text-amber-200">计划重试：{formatDateTime(job.nextAttemptAt)}</p> : null}
    {job.exportSummary ? <p className="text-xs text-zinc-400">{job.exportSummary.recordCount} 个对象 · {job.exportSummary.attachmentCount} 个附件 · {Math.max(1, Math.ceil(Number(job.exportSummary.sizeBytes) / 1024))} KiB · 有效至 {formatDateTime(job.expiresAt)}</p> : null}
    {durable && job.status === "SUCCEEDED" && !canDownload ? <p className="text-xs text-amber-200">归档已过期、权限已变化或下载已关闭；需要时请重新申请。</p> : null}
    {job.errorCode ? <p className="flex items-start gap-2 text-xs text-rose-200"><AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />{dataRequestError(500, job.errorCode)}</p> : null}
    {job.kind === "DELETE" ? <p className="text-xs text-amber-200">该任务只记录删除影响预览；不会物理删除或归档落盘。</p> : null}
    {!durable && job.kind === "EXPORT" ? <p className="text-xs text-zinc-400">历史描述信息不能用于文件下载，请创建新的导出任务。</p> : null}
  </Card>;
}

function isExportPreview(preview: DataExportPreviewView | DataDeletePreviewView): preview is DataExportPreviewView {
  return "manifestSha256" in preview;
}

function isTerminalJob(status: DataJobStatus): boolean {
  return ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(status);
}

function statusLabel(status: DataJobStatus): string {
  return {
    QUEUED: "排队中", RUNNING: "运行中", PAUSED: "已暂停", CANCEL_REQUESTED: "取消中", SUCCEEDED: "已完成", FAILED: "失败", CANCELLED: "已取消", EXPIRED: "已过期",
  }[status];
}

function statusTone(status: DataJobStatus): "neutral" | "info" | "success" | "warning" | "danger" {
  if (status === "SUCCEEDED") return "success";
  if (["FAILED", "EXPIRED"].includes(status)) return "danger";
  if (["PAUSED", "CANCEL_REQUESTED"].includes(status)) return "warning";
  if (["QUEUED", "RUNNING"].includes(status)) return "info";
  return "neutral";
}

function deleteBlockerLabel(blocker: string): string {
  return {
    DELETE_EXECUTION_NOT_IMPLEMENTED: "删除执行能力尚未实现",
    BACKUP_DELETION_LEDGER_NOT_CONFIRMED: "备份删除账本尚未确认",
    ATTACHMENT_PHYSICAL_DELETE_NOT_AUTHORIZED: "附件物理删除尚未授权",
  }[blocker] ?? blocker;
}

function dataRequestError(status: number, error?: string): string {
  const quotaError = dataJobQuotaErrorText(error); if (quotaError) return quotaError;
  if (status === 0) return "网络响应未确认，服务端可能已经处理；请刷新核对后重试。";
  if (error === "DATA_EXPORT_DISABLED") return "完整导出未启用，不能创建或下载归档。";
  if (error === "DATA_EXPORT_AUTHORIZATION_CHANGED") return "权限或范围版本已变化，请重新预览并提交新的导出。";
  if (error === "DATA_EXPORT_DOWNLOAD_NOT_FOUND") return "下载授权已使用、撤销或过期，请重新获取。";
  if (error === "DATA_EXPORT_DOWNLOAD_BUSY") return "该下载授权正在校验，请稍后重试。";
  if (error === "DATA_EXPORT_LIMIT_EXCEEDED" || error === "DATA_EXPORT_SCOPE_LIMIT") return "导出超出安全大小或条目上限，请缩小至单个工作区后重新申请。";
  if (error && /DATA_EXPORT_(?:FILE_|ARCHIVE_|ATTACHMENT_|DOWNLOAD_INVALID)/.test(error)) return "文件缺失或校验不一致，未提供下载；请检查附件后重新申请。";
  if (error === "DATA_JOB_REVISION_CONFLICT" || error === "DATA_EXPORT_SCOPE_BUSY") return "任务正在更新，请刷新后重试。";
  if (error === "DATA_LIFECYCLE_DISABLED") return "当前环境未启用数据生命周期候选能力。";
  if (error === "DATA_JOB_CONFLICT") return "任务刚刚发生变化，请刷新后再操作。";
  if (error === "DATA_EXPORT_PACKAGE_NOT_READY" || error === "DATA_EXPORT_NOT_READY") return "导出包尚未由受控后台流程准备好，暂时不能生成凭证。";
  if (error === "REAUTHENTICATION_REQUIRED") return "请先在账户安全中重新验证身份。";
  if (status === 403 || status === 404) return "当前账户无权查看这项数据，或能力尚未开放。";
  return error ? `数据任务未完成（${error}），请刷新后重试。` : "数据任务未完成，请刷新后重试。";
}

function createDataIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `data-${crypto.randomUUID()}`;
  return `data-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
