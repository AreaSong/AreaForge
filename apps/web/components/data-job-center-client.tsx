"use client";

import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  Download,
  Eye,
  FileArchive,
  PauseCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cancelDataLifecycleJob,
  createExportDownloadGrant,
  listDataLifecycleJobs,
  previewDataLifecycle,
  requestDataLifecycleJob,
  revokeExportDownloadGrants,
  retryDataLifecycleJob,
  type DataDeletePreviewView,
  type DataDownloadGrantView,
  type DataExportPreviewView,
  type DataJobKind,
  type DataJobScope,
  type DataJobStatus,
  type DataJobView,
} from "@/lib/api/data-lifecycle";
import { formatDateTime } from "@/lib/formatters";
import { isConflict } from "@/lib/client/api-errors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, SectionCard } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";
import { Metric } from "@/components/ui/metric";

export interface DataJobWorkspaceOption {
  id: string;
  name: string;
  role?: string;
}

export function DataJobCenterClient(props: {
  enabled: boolean;
  workspaces?: DataJobWorkspaceOption[];
  initialJobs?: DataJobView[];
}) {
  const [jobs, setJobs] = useState<DataJobView[]>(props.initialJobs ?? []);
  const [preview, setPreview] = useState<DataExportPreviewView | DataDeletePreviewView | null>(null);
  const [kind, setKind] = useState<DataJobKind>("EXPORT");
  const [scope, setScope] = useState<DataJobScope>("ACCOUNT");
  const [workspaceId, setWorkspaceId] = useState("");
  const [grants, setGrants] = useState<Record<string, DataDownloadGrantView>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "success" | "warning" | "danger"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!props.enabled) return;
    setPending("refresh");
    const result = await listDataLifecycleJobs();
    setPending(null);
    if (result.ok && result.body?.jobs) {
      setJobs(result.body.jobs);
      return;
    }
    setNotice({ tone: result.status === 404 ? "warning" : "danger", text: dataRequestError(result.status, result.body?.error) });
  }, [props.enabled]);

  useEffect(() => {
    if (!props.enabled || props.initialJobs) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [props.enabled, props.initialJobs, refresh]);

  const previewMatchesForm = preview?.scope === scope;
  const activeCount = useMemo(
    () => jobs.filter((job) => !isTerminalJob(job.status)).length,
    [jobs],
  );
  const completedCount = useMemo(
    () => jobs.filter((job) => job.status === "SUCCEEDED").length,
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
              当前环境没有开放 v1.6 数据生命周期候选能力。现有导入/导出入口仍按原有鉴权边界工作；这里不会创建任务、归档文件或执行删除。
            </p>
          </div>
        </div>
      </SectionCard>
    );
  }

  async function runPreview() {
    if (scope === "WORKSPACE" && !workspaceId) {
      setNotice({ tone: "warning", text: "请选择一个工作区后再预览。" });
      return;
    }
    setPending("preview");
    setNotice(null);
    const result = await previewDataLifecycle(kind, scope, scope === "WORKSPACE" ? workspaceId : undefined);
    setPending(null);
    if (!result.ok || !result.body?.preview) {
      setNotice({ tone: "danger", text: dataRequestError(result.status, result.body?.error) });
      return;
    }
    setPreview(result.body.preview);
    setNotice({ tone: "success", text: "范围预览已生成；尚未创建任务。" });
  }

  async function createJob() {
    if (!previewMatchesForm) {
      setNotice({ tone: "warning", text: "请先为当前范围生成预览，再创建数据任务。" });
      return;
    }
    if (scope === "WORKSPACE" && !workspaceId) {
      setNotice({ tone: "warning", text: "请选择一个工作区后再创建任务。" });
      return;
    }
    setPending("create");
    setNotice(null);
    const result = await requestDataLifecycleJob({
      kind,
      scope,
      workspaceId: scope === "WORKSPACE" ? workspaceId : undefined,
      idempotencyKey: createDataIdempotencyKey(),
    });
    setPending(null);
    if (!result.ok || !result.body?.job) {
      setNotice({ tone: "danger", text: dataRequestError(result.status, result.body?.error) });
      return;
    }
    setJobs((current) => [result.body!.job!, ...current.filter((job) => job.id !== result.body!.job!.id)]);
    setPreview(null);
    setNotice({ tone: "success", text: kind === "DELETE" ? "删除预览任务已创建；当前仍停留在预览状态，不会物理删除。" : "导出任务已提交，Web 只记录受控任务状态。" });
  }

  async function mutateJob(job: DataJobView, action: "cancel" | "retry") {
    const confirmation = action === "cancel"
      ? "确认取消这个数据任务？正在运行的任务只会提交取消请求。"
      : "确认重试这个导出任务？服务端会重新校验当前状态。";
    if (!window.confirm(confirmation)) return;
    setPending(`${action}:${job.id}`);
    const result = action === "cancel"
      ? await cancelDataLifecycleJob(job.id, job.revision)
      : await retryDataLifecycleJob(job.id, job.revision);
    setPending(null);
    if (!result.ok || !result.body?.job) {
      setNotice({ tone: "danger", text: dataRequestError(result.status, result.body?.error) });
      if (isConflict(result)) await refresh();
      return;
    }
    replaceJob(result.body.job);
    setNotice({ tone: "success", text: action === "cancel" ? "取消请求已提交。" : "重试请求已提交。" });
  }

  async function issueGrant(job: DataJobView) {
    setPending(`grant:${job.id}`);
    const result = await createExportDownloadGrant(job.id);
    setPending(null);
    if (!result.ok || !result.body?.grant) {
      setNotice({ tone: "danger", text: dataRequestError(result.status, result.body?.error) });
      return;
    }
    setGrants((current) => ({ ...current, [job.id]: result.body!.grant! }));
    setNotice({ tone: "success", text: "一次性下载凭证已生成；请在有效期内交给受控下载流程兑换。" });
  }

  async function revokeGrant(job: DataJobView) {
    if (!window.confirm("确认撤销这个导出任务的未消费下载凭证？")) return;
    setPending(`revoke:${job.id}`);
    const result = await revokeExportDownloadGrants(job.id);
    setPending(null);
    if (!result.ok) {
      setNotice({ tone: "danger", text: dataRequestError(result.status, result.body?.error) });
      return;
    }
    setGrants((current) => {
      const next = { ...current };
      delete next[job.id];
      return next;
    });
    setNotice({ tone: "success", text: `已撤销 ${result.body?.revokedCount ?? 0} 个未消费下载凭证。` });
  }

  function replaceJob(job: DataJobView) {
    setJobs((current) => current.map((item) => (item.id === job.id ? job : item)));
  }

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="活动任务" value={activeCount} note="服务端状态" icon={RefreshCw} tone="info" layout="tile" />
        <Metric label="已完成导出" value={completedCount} note="仅统计当前列表" icon={CheckCircle2} tone="success" layout="tile" />
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
          <label className="text-xs text-zinc-300">任务类型<Select className="mt-2" disabled={pending !== null} value={kind} onChange={(event) => { setKind(event.target.value as DataJobKind); setPreview(null); }}><option value="EXPORT">导出（脱敏清单）</option><option value="DELETE">删除预览（不执行删除）</option></Select></label>
          <label className="text-xs text-zinc-300">范围<Select className="mt-2" disabled={pending !== null} value={scope} onChange={(event) => { setScope(event.target.value as DataJobScope); setPreview(null); }}><option value="ACCOUNT">当前账户</option><option value="WORKSPACE">指定工作区</option></Select></label>
          {scope === "WORKSPACE" ? <label className="text-xs text-zinc-300">工作区<Select className="mt-2" disabled={pending !== null} value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); setPreview(null); }}><option value="">选择工作区</option>{(props.workspaces ?? []).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</Select></label> : <div className="hidden md:block" aria-hidden="true" />}
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <Button disabled={pending !== null} onClick={() => void runPreview()} type="button" variant="secondary"><Eye className="size-4" aria-hidden="true" />生成范围预览</Button>
          <Button disabled={pending !== null || !previewMatchesForm} onClick={() => void createJob()} type="button"><FileArchive className="size-4" aria-hidden="true" />{kind === "DELETE" ? "创建删除预览任务" : "创建导出任务"}</Button>
        </div>

        {preview ? <PreviewPanel preview={preview} /> : <p className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-xs text-zinc-500">尚未生成预览；不会在后台猜测范围。</p>}
        {notice ? <Alert tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"}>{notice.text}</Alert> : null}
      </SectionCard>

      <SectionCard variant="subtle" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-base font-semibold text-white">任务回执</h2><p className="mt-1 text-xs text-zinc-500">每一行都来自服务端任务 DTO；过期、冲突或权限变化会明确提示。</p></div>
          <Badge tone="info">最多显示 100 条</Badge>
        </div>
        {jobs.length === 0 ? <EmptyState title="还没有数据任务" description="生成预览后提交第一项导出或删除预览，系统会保留可追踪的状态回执。" /> : <div className="space-y-3">{jobs.map((job) => <DataJobRow key={job.id} job={job} grant={grants[job.id]} pending={pending} onMutate={mutateJob} onGrant={issueGrant} onRevokeGrant={revokeGrant} />)}</div>}
      </SectionCard>
    </div>
  );
}

function PreviewPanel({ preview }: { preview: DataExportPreviewView | DataDeletePreviewView }) {
  if (isExportPreview(preview)) {
    return <Card variant="subtle" className="space-y-3"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Eye className="size-4 text-sky-300" aria-hidden="true" />导出范围预览</CardTitle></CardHeader><CardContent className="space-y-3 pt-0"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="对象" value={preview.recordCount} layout="compact" valueSize="base" /><Metric label="附件" value={preview.attachmentCount} layout="compact" valueSize="base" /><Metric label="脱敏字段" value={preview.omittedFieldCount} layout="compact" valueSize="base" /><Metric label="包状态" value="未创建" layout="compact" valueSize="base" tone="warning" /></div><p className="break-all font-mono text-[11px] text-zinc-500">manifest {preview.manifestSha256}</p><div className="rounded-xl border border-white/10 bg-black/10 p-3"><p className="text-xs font-medium text-zinc-300">对象摘要（前 8 条）</p><ul aria-label="脱敏对象摘要" className="mt-2 space-y-1.5 text-[11px] text-zinc-500">{preview.entries.slice(0, 8).map((entry) => <li className="flex flex-wrap gap-x-2 gap-y-1" key={`${entry.kind}:${entry.id}`}><span className="text-zinc-300">{entry.kind}</span><span className="break-all">{entry.id}</span><span className="font-mono">{entry.sha256}</span><span>省略 {entry.omittedFieldCount} 项</span></li>)}</ul>{preview.entries.length > 8 ? <p className="mt-2 text-[11px] text-zinc-500">其余 {preview.entries.length - 8} 条仅计入 manifest，不在页面展开。</p> : null}</div><p className="text-xs text-zinc-400">这是脱敏清单摘要；当前不会在 Web 容器写入归档文件或暴露内部路径。</p></CardContent></Card>;
  }
  return <Card variant="subtle" className="space-y-3 border-amber-300/20"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Trash2 className="size-4 text-amber-300" aria-hidden="true" />删除影响预览</CardTitle></CardHeader><CardContent className="space-y-3 pt-0"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="对象" value={preview.totalObjects} layout="compact" valueSize="base" /><Metric label="冷静期至" value={formatDateTime(preview.cooldownUntil)} layout="compact" valueSize="sm" /><Metric label="物理删除" value="未支持" layout="compact" valueSize="base" tone="warning" /><Metric label="执行状态" value="仅预览" layout="compact" valueSize="base" tone="warning" /></div><p className="break-all font-mono text-[11px] text-zinc-500">scope {preview.scopeHash}</p>{preview.rankingBlockerCount !== undefined ? <p className="text-xs text-zinc-300">排名联动：{preview.rankingBlockerCount} 个未解散挑战、{preview.rankingParticipationCount ?? 0} 条参与记录、{preview.rankingProjectionCount ?? 0} 条投影待处理。</p> : null}<p className="text-xs leading-5 text-amber-100">当前实现不会物理删除数据库、附件或备份，也不会把预览当作授权。以下阻塞项由服务端返回：</p><ul className="list-disc space-y-1 pl-5 text-xs text-zinc-400">{preview.blockers.map((blocker) => <li key={blocker}>{deleteBlockerLabel(blocker)}</li>)}</ul></CardContent></Card>;
}

function DataJobRow(props: {
  job: DataJobView;
  grant?: DataDownloadGrantView;
  pending: string | null;
  onMutate: (job: DataJobView, action: "cancel" | "retry") => Promise<void>;
  onGrant: (job: DataJobView) => Promise<void>;
  onRevokeGrant: (job: DataJobView) => Promise<void>;
}) {
  const { job } = props;
  const canCancel = ["QUEUED", "RUNNING", "PAUSED", "CANCEL_REQUESTED"].includes(job.status);
  const canRetry = job.kind === "EXPORT" && job.status === "FAILED" && job.retryable;
  const canGrant = job.kind === "EXPORT" && job.status === "SUCCEEDED";
  return <Card variant="subtle" className="space-y-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="font-mono text-sm text-white">{job.id}</strong><Badge tone={statusTone(job.status)}>{statusLabel(job.status)}</Badge><Badge tone="neutral">{job.kind === "EXPORT" ? "导出" : "删除预览"} · {job.scope === "ACCOUNT" ? "账户" : "工作区"}</Badge></div><p className="mt-1 text-xs text-zinc-500">创建于 {formatDateTime(job.createdAt)} · revision {job.revision} · 第 {job.attempt} 次尝试</p></div><div className="flex flex-wrap gap-2">{canCancel ? <Button disabled={props.pending !== null} onClick={() => void props.onMutate(job, "cancel")} size="sm" type="button" variant="secondary"><XCircle className="size-3.5" aria-hidden="true" />取消</Button> : null}{canRetry ? <Button disabled={props.pending !== null} onClick={() => void props.onMutate(job, "retry")} size="sm" type="button" variant="secondary"><RefreshCw className="size-3.5" aria-hidden="true" />重试</Button> : null}{canGrant ? <Button disabled={props.pending !== null} onClick={() => void props.onGrant(job)} size="sm" type="button"><Download className="size-3.5" aria-hidden="true" />生成下载凭证</Button> : null}{job.kind === "EXPORT" && job.status !== "CANCELLED" ? <Button disabled={props.pending !== null} onClick={() => void props.onRevokeGrant(job)} size="sm" type="button" variant="secondary"><PauseCircle className="size-3.5" aria-hidden="true" />撤销凭证</Button> : null}</div></div><div className="space-y-1"><div className="flex items-center justify-between text-[11px] text-zinc-500"><span>服务端进度</span><span>{Math.max(0, Math.min(100, job.progress))}%</span></div><progress aria-label={`${job.id} 服务端进度`} className="h-2 w-full accent-teal-400" max={100} value={job.progress} /></div>{job.errorCode ? <p className="flex items-center gap-2 text-xs text-rose-200"><AlertCircle className="size-3.5" aria-hidden="true" />{job.errorCode}{job.retryable ? " · 可重试" : ""}</p> : null}{job.kind === "DELETE" ? <p className="text-xs text-amber-200">该任务只记录删除影响预览；不会物理删除或归档落盘。</p> : null}{props.grant ? <GrantNotice grant={props.grant} /> : null}</Card>;
}

function GrantNotice({ grant }: { grant: DataDownloadGrantView }) {
  async function copyToken() {
    try {
      await navigator.clipboard.writeText(grant.token);
    } catch {
      // Clipboard permission is optional; the token remains selectable below.
    }
  }
  return <div className="space-y-2 rounded-xl border border-teal-300/20 bg-teal-500/[0.06] p-3"><p className="flex items-center gap-2 text-xs font-medium text-teal-100"><CheckCircle2 className="size-3.5" aria-hidden="true" />一次性下载凭证 · 有效至 {formatDateTime(grant.expiresAt)}</p><div className="flex flex-wrap gap-2"><Input aria-label="一次性下载凭证" className="min-w-[16rem] flex-1 font-mono text-xs" readOnly value={grant.token} /><Button aria-label="复制下载凭证" onClick={() => void copyToken()} size="sm" type="button" variant="secondary"><Clipboard className="size-3.5" aria-hidden="true" />复制</Button></div><p className="text-[11px] text-zinc-400">凭证只能消费一次；此页面不展示归档路径，也不直接执行文件下载。</p></div>;
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
  if (status === 0) return "网络连接不可用，任务状态未改变；恢复网络后重试。";
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
