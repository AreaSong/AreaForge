"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { reauthenticate } from "@/lib/api/account";
import { listDeletions, previewDeletion, createDeletion, controlDeletion, readDeletionReceipt, deletionCandidates } from "@/lib/api/data-deletion";
import type { DeletionCandidate, DeletionIntentView, DeletionPreviewView, DeletionScope, DeletionTargetInput, TrashResourceType } from "@/lib/contracts/data-deletion";
import { createExclusiveOperationGate, createLatestOperationGate } from "@/lib/client/operation-gates";
import { createDeletionRequestIdentity } from "@/lib/client/data-deletion-request";
import { isUnauthorized } from "@/lib/client/api-errors";
import { deletionError, deletionKinds } from "./data-deletion-labels";
import { DeletionRecords } from "./data-deletion-records";

export function DataDeletionCenter(props: { enabled: boolean; workspaces: Array<{ id: string; name: string; role?: string }> }) {
  const controlId = useId();
  const [scope, setScope] = useState<DeletionScope>("RESOURCE");
  const [workspaceId, setWorkspaceId] = useState(props.workspaces[0]?.id ?? "");
  const [resourceType, setResourceType] = useState<TrashResourceType>("Note");
  const [resourceId, setResourceId] = useState("");
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<DeletionCandidate[]>([]);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [preview, setPreview] = useState<DeletionPreviewView | null>(null);
  const [intents, setIntents] = useState<DeletionIntentView[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [receiptOnly, setReceiptOnly] = useState(false);
  const actions = useRef(createExclusiveOperationGate());
  const refreshGate = useRef(createLatestOperationGate());
  const alive = useRef(true);
  const request = useRef<ReturnType<typeof createDeletionRequestIdentity> | null>(null);
  const receipts = useRef(new Map<string, string>());
  const target = useMemo<DeletionTargetInput>(() => scope === "ACCOUNT" ? { scope } : scope === "WORKSPACE" ? { scope, workspaceId }
    : { scope, workspaceId, resourceType, resourceId }, [scope, workspaceId, resourceType, resourceId]);
  const phrase = scope === "ACCOUNT" ? "删除我的账户" : scope === "WORKSPACE" ? "删除此工作区" : "放入回收站";
  const workspaces = scope === "WORKSPACE" ? props.workspaces.filter(row => row.role === "OWNER") : props.workspaces;
  const validTarget = props.enabled && (scope === "ACCOUNT" || workspaces.some(row => row.id === workspaceId))
    && (scope !== "RESOURCE" || candidates.some(row => row.id === resourceId));

  const refresh = useCallback(async () => {
    if (actions.current.isLocked() || !alive.current) return;
    const token = refreshGate.current.begin();
    const result = await listDeletions();
    if (!alive.current || !refreshGate.current.isCurrent(token)) return;
    if (result.ok && result.body?.intents) { setIntents(result.body.intents); setRefreshError(null); setReceiptOnly(false); return; }
    if (!isUnauthorized(result)) { setRefreshError(deletionError(result.body?.error) + " 当前仍显示上次完整状态。"); return; }
    const recovered: DeletionIntentView[] = [];
    for (const [id, receipt] of receipts.current) {
      const response = await readDeletionReceipt(id, receipt);
      if (response.ok && response.body?.intent) recovered.push(response.body.intent);
    }
    if (!alive.current || !refreshGate.current.isCurrent(token)) return;
    if (recovered.length) {
      setIntents(previous => [...recovered, ...previous.filter(row => !recovered.some(item => item.id === row.id))]);
      setReceiptOnly(true); setRefreshError("当前会话不可用；本次回执只读，其他记录保留上次状态。刷新页面后不再保留回执凭据。");
    }
    else setRefreshError(deletionError(result.body?.error) + " 当前仍显示上次状态。");
  }, []);

  useEffect(() => {
    alive.current = true;
    const reads = refreshGate.current; const mutations = actions.current;
    const initial = setTimeout(() => { void refresh(); }, 0);
    const timer = setInterval(() => { void refresh(); }, 5000);
    return () => { alive.current = false; reads.invalidate(); mutations.invalidate(); clearTimeout(initial); clearInterval(timer); };
  }, [refresh]);

  function invalidate() { setPreview(null); setConfirmation(""); request.current = null; setNotice(null); refreshGate.current.invalidate(); }
  async function run(label: string, effect: () => Promise<void>) {
    const token = actions.current.acquire(); if (!token) return;
    refreshGate.current.invalidate(); setPending(label); setNotice(null);
    try { await effect(); }
    catch { if (alive.current) setNotice(deletionError()); }
    finally { if (actions.current.release(token) && alive.current) { setPending(null); void refresh(); } }
  }
  function accept(row: DeletionIntentView) { setIntents(previous => [row, ...previous.filter(item => item.id !== row.id)]); }
  async function verify() {
    const value = password;
    await run("verify", async () => {
      const result = await reauthenticate(value); setPassword("");
      if (alive.current) setNotice(result.ok ? "身份已重新验证，可以继续核对范围。" : deletionError(result.body?.error));
    });
  }
  async function loadCandidates() {
    invalidate();
    const currentWorkspace = workspaceId; const currentType = resourceType;
    await run("candidates", async () => {
      const result = await deletionCandidates(currentWorkspace, currentType, search);
      if (!alive.current) return;
      if (result.ok && result.body?.candidates) { setCandidates(result.body.candidates); setResourceId(""); }
      else setNotice(deletionError(result.body?.error));
    });
  }
  async function inspect() {
    if (!validTarget) return;
    const input = { ...target };
    await run("preview", async () => {
      const result = await previewDeletion(input);
      if (!alive.current) return;
      if (result.ok && result.body?.preview) { setPreview(result.body.preview); setConfirmation(""); request.current = null; }
      else setNotice(deletionError(result.body?.error));
    });
  }
  async function confirm() {
    if (!validTarget || !preview?.canConfirm || confirmation !== phrase) return;
    request.current ??= createDeletionRequestIdentity();
    const identity = request.current; const input = { ...target, ...identity, fingerprint: preview.fingerprint, confirmation };
    await run("confirm", async () => {
      const result = await createDeletion(input);
      if (!alive.current) return;
      if (result.ok && result.body?.intent) {
        receipts.current.set(result.body.intent.id, identity.receiptToken); accept(result.body.intent);
        setPreview(null); setConfirmation(""); request.current = null;
        if (input.scope === "RESOURCE") { setResourceId(""); setCandidates(previous => previous.filter(row => row.id !== input.resourceId)); }
        setNotice(input.scope === "RESOURCE" ? "已放入回收站，恢复期内可恢复对象。" : "删除请求已登记，冷静期内可取消。未到期不会执行物理删除。");
      } else {
        setNotice(deletionError(result.body?.error));
        if (["DATA_DELETE_PREVIEW_CHANGED", "DATA_DELETE_AUTHORIZATION_CHANGED"].includes(result.body?.error ?? "")) { setPreview(null); request.current = null; }
      }
    });
  }
  async function control(row: DeletionIntentView, action: "cancel" | "restore" | "retry") {
    if (action === "retry" && !window.confirm("重新确认当前权限并重试同一批冻结对象？不会增加范围或延长恢复期。")) return;
    await run(row.id, async () => {
      const result = await controlDeletion(row.id, action, row.revision);
      if (!alive.current) return;
      if (result.ok && result.body?.intent) { accept(result.body.intent); setNotice(action === "restore" ? "对象已恢复。" : action === "cancel" ? "删除已取消。" : "已重新确认，等待后台重试。"); }
      else setNotice(deletionError(result.body?.error));
    });
  }

  return <section aria-labelledby="data-deletion-title" className="space-y-4">
    <div className="border-b border-white/10 pb-3">
      <h2 id="data-deletion-title" className="flex items-center gap-2 text-base font-semibold text-white"><Trash2 className="size-4" aria-hidden="true" />回收站与删除</h2>
      <p className="mt-1 text-sm text-zinc-400">仅处理本人数据。共享归属不清时停止，不会替其他成员删除。</p>
    </div>
    {!props.enabled ? <p className="rounded-xl border border-amber-400/20 p-4 text-sm text-amber-200">删除功能未启用；已有请求仍可取消或恢复。</p> : <Card variant="subtle" className="min-w-0 space-y-4 p-4">
      <Field label="删除范围" htmlFor={controlId + "-scope"}><Select id={controlId + "-scope"} className="min-h-11 w-full" value={scope} disabled={!!pending} onChange={event => { invalidate(); setScope(event.target.value as DeletionScope); setCandidates([]); setResourceId(""); }}>
        <option value="RESOURCE">单个对象 · 回收站</option><option value="WORKSPACE">整个工作区</option><option value="ACCOUNT">我的账户</option>
      </Select></Field>
      {scope !== "ACCOUNT" && <Field label="对象所在工作区" htmlFor={controlId + "-workspace"}><Select id={controlId + "-workspace"} className="min-h-11 w-full" value={workspaceId} disabled={!!pending} onChange={event => { invalidate(); setWorkspaceId(event.target.value); setCandidates([]); setResourceId(""); }}>
        <option value="">请选择工作区</option>{workspaces.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </Select></Field>}
      {scope === "RESOURCE" && <div className="space-y-3">
        <Field label="对象类型" htmlFor={controlId + "-kind"}><Select id={controlId + "-kind"} className="min-h-11 w-full" value={resourceType} disabled={!!pending} onChange={event => { invalidate(); setResourceType(event.target.value as TrashResourceType); setCandidates([]); setResourceId(""); }}>
          {(["Note", "Mistake", "StudyTask", "StudyResource", "KnowledgePoint"] as const).map(kind => <option key={kind} value={kind}>{deletionKinds[kind]}</option>)}
        </Select></Field>
        <label className="block space-y-2 text-sm text-zinc-300"><span>按名称查找本人对象</span><Input className="min-h-11 w-full" maxLength={100} value={search} disabled={!!pending} onChange={event => { invalidate(); setSearch(event.target.value); setResourceId(""); setCandidates([]); }} /></label>
        <Button size="lg" disabled={!!pending || !workspaceId} onClick={() => { void loadCandidates(); }}>加载本人对象</Button>
        <Field label="选择本人对象" htmlFor={controlId + "-resource"}><Select id={controlId + "-resource"} className="min-h-11 w-full" value={resourceId} disabled={!!pending} onChange={event => { invalidate(); setResourceId(event.target.value); }}>
          <option value="">最多显示 100 项，可按名称缩小范围</option>{candidates.map(row => <option key={row.id} value={row.id}>{row.title.slice(0, 120)}</option>)}
        </Select></Field>
      </div>}
      <div className="rounded-xl border-l-2 border-amber-400 bg-amber-400/5 p-3 text-sm text-zinc-300">
        {scope === "RESOURCE" ? "放入回收站后从普通页面隐藏。30 天内可恢复，到期后由后台物理删除。" : "确认后冻结该范围并进入 24 小时冷静期。开始不可逆处理前可取消。"}
        {scope === "ACCOUNT" && <p className="mt-2">完成后会删除账户并退出登录；登录安全状态会在执行时按本人账户统一撤销。</p>}
      </div>
      <div className="space-y-2 border-t border-white/10 pt-3">
        <label className="block space-y-2 text-sm text-zinc-300"><span>删除操作的当前密码</span><Input className="min-h-11 w-full" type="password" autoComplete="current-password" value={password} disabled={!!pending} onChange={event => setPassword(event.target.value)} /></label>
        <Button size="lg" disabled={!!pending || !password} onClick={() => { void verify(); }}><ShieldCheck className="size-4" aria-hidden="true" />验证身份</Button>
      </div>
      <Button size="lg" disabled={!!pending || !validTarget} onClick={() => { void inspect(); }}>预览删除影响</Button>
      {preview && <div className="space-y-3 rounded-xl border border-amber-400/25 p-3" aria-label="删除影响预览">
        <strong className="block text-sm text-white">已核对 {preview.totalObjects} 项记录</strong>
        <p className="break-words text-sm text-zinc-200">目标：{preview.targetLabel}</p>
        <details><summary className="cursor-pointer text-sm text-zinc-300">查看分类计数</summary><dl className="mt-2 space-y-1 text-sm">{Object.entries(preview.counts).map(([kind, count]) => <div key={kind} className="flex min-w-0 justify-between gap-2"><dt className="break-all text-zinc-400">{deletionKinds[kind] ?? kind}</dt><dd className="font-mono text-zinc-200">{count}</dd></div>)}</dl></details>
        {preview.blockers.map(code => <p key={code} className="text-sm text-rose-200">{deletionError(code)}</p>)}
        {preview.canConfirm && <><label className="block space-y-2 text-sm text-zinc-300"><span>输入“{phrase}”以确认</span><Input className="min-h-11 w-full" value={confirmation} disabled={!!pending} autoComplete="off" onChange={event => setConfirmation(event.target.value)} /></label>
          <Button size="lg" variant="danger" disabled={!!pending || !validTarget || confirmation !== phrase} onClick={() => { void confirm(); }}>{phrase}</Button></>}
      </div>}
    </Card>}
    {!props.enabled && intents.length > 0 && <div className="space-y-2"><label className="block space-y-2 text-sm text-zinc-300"><span>删除操作的当前密码</span><Input className="min-h-11 w-full" type="password" autoComplete="current-password" value={password} disabled={!!pending} onChange={event => setPassword(event.target.value)} /></label>
      <Button size="lg" disabled={!!pending || !password} onClick={() => { void verify(); }}>验证身份</Button></div>}
    <div aria-live="polite" className="space-y-2 text-sm text-zinc-300">{pending && <p>正在处理，请稍候…</p>}{notice && <p>{notice}</p>}{refreshError && <p className="text-amber-200">{refreshError}</p>}</div>
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-white">处理记录</h3><Button size="lg" variant="ghost" disabled={!!pending} onClick={() => { void refresh(); }}>刷新删除状态</Button></div>
    <DeletionRecords intents={intents} busy={!!pending || receiptOnly} enabled={props.enabled} control={(row, action) => { void control(row, action); }} />
  </section>;
}
