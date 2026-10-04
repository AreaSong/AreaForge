"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, RefreshCw, Share2, UserCheck, UserX } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/feedback";
import {
  createWorkspaceShareGrant,
  createCoachSuggestion,
  decideCoachSuggestion,
  getSharedResourceDetail,
  listCoachSuggestions,
  listOwnedMistakes,
  listOwnedNotes,
  listSharedWithMe,
  listWorkspaceShareGrants,
  revokeWorkspaceShareGrant,
  updateWorkspaceShareGrant,
  type SharedResourceDetailView,
  type CoachSuggestionView,
  type ShareableResourceType,
  type SharedResourceView,
  type WorkspaceShareGrantView,
} from "@/lib/api/collaboration";
import type { WorkspaceMemberView } from "@/lib/api/workspace-membership";
import type { WorkspaceShareGrantAccess, WorkspaceShareGrantScope } from "@areaforge/core";

interface ResourceOption {
  key: string;
  type: ShareableResourceType;
  id: string;
  label: string;
}

export function WorkspaceCollaborationClient(props: {
  workspaceId: string;
  members: WorkspaceMemberView[];
  capabilities: string[];
  currentUserId: string;
  enabled: boolean;
}) {
  const [grants, setGrants] = useState<WorkspaceShareGrantView[]>([]);
  const [shared, setShared] = useState<SharedResourceView[]>([]);
  const [suggestions, setSuggestions] = useState<CoachSuggestionView[]>([]);
  const [resources, setResources] = useState<ResourceOption[]>([]);
  const [sharedDetails, setSharedDetails] = useState<Record<string, SharedResourceDetailView>>({});
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canManageShares = props.capabilities.includes("share:manage-self");
  const canCoach = props.capabilities.includes("coach:suggest");

  const load = useCallback(async () => {
    setPending(true);
    const [grantResult, sharedResult, suggestionResult, noteResult, mistakeResult] = await Promise.all([
      canManageShares ? listWorkspaceShareGrants(props.workspaceId) : Promise.resolve(null),
      listSharedWithMe(),
      listCoachSuggestions(props.workspaceId),
      canManageShares ? listOwnedNotes() : Promise.resolve(null),
      canManageShares ? listOwnedMistakes() : Promise.resolve(null),
    ]);
    setPending(false);
    setGrants(grantResult?.ok ? grantResult.body?.grants ?? [] : []);
    setShared(sharedResult.ok ? sharedResult.body?.sharedResources ?? [] : []);
    setSuggestions(suggestionResult.ok ? suggestionResult.body?.suggestions ?? [] : []);
    setResources(buildResourceOptions(noteResult?.ok ? noteResult.body?.notes ?? [] : [], mistakeResult?.ok ? mistakeResult.body?.mistakes ?? [] : []));
    if (grantResult && !grantResult.ok && grantResult.status !== 404) setNotice(errorText(grantResult.status, grantResult.body?.error));
  }, [canManageShares, props.workspaceId]);

  useEffect(() => {
    if (!props.enabled) return;
    const handle = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [load, props.enabled]);

  if (!props.enabled) return null;
  return (
    <div className="space-y-5 border-t border-white/10 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="text-sm font-semibold text-white">分享与协作</h3><p className="mt-1 text-xs text-zinc-500">分享是对象级授权，不会因为成员角色自动开放私密正文。</p></div>
        <Button disabled={pending} onClick={() => void load()} size="sm" type="button" variant="secondary"><RefreshCw className="size-3.5" />刷新</Button>
      </div>
      {canManageShares ? <GrantComposer workspaceId={props.workspaceId} currentUserId={props.currentUserId} members={props.members} resources={resources} pending={pending} onCreated={load} onError={setNotice} /> : null}
      {canManageShares ? <GrantList grants={grants} pending={pending} onUpdate={async (grant, input) => { setPending(true); const result = await updateWorkspaceShareGrant(props.workspaceId, grant.id, input); setPending(false); if (!result.ok) return setNotice(errorText(result.status, result.body?.error)); await load(); }} onRevoke={async (grant) => { setPending(true); const result = await revokeWorkspaceShareGrant(props.workspaceId, grant.id, grant.revision); setPending(false); if (!result.ok) return setNotice(errorText(result.status, result.body?.error)); await load(); }} /> : null}
      <SharedResourceList items={shared} details={sharedDetails} onOpen={async (item) => { const result = await getSharedResourceDetail(item.resourceType, item.resourceId); if (!result.ok || !result.body?.resource) return setNotice(errorText(result.status, result.body?.error)); setSharedDetails((current) => ({ ...current, [`${item.resourceType}:${item.resourceId}`]: result.body!.resource! })); }} />
      {canCoach ? <CoachSuggestionComposer workspaceId={props.workspaceId} shared={shared} pending={pending} onCreated={load} onError={setNotice} /> : null}
      {canCoach || suggestions.length > 0 ? <CoachSuggestionList currentUserId={props.currentUserId} suggestions={suggestions} pending={pending} onDecide={async (suggestion, action) => { setPending(true); const result = await decideCoachSuggestion(suggestion.id, action, suggestion.revision); setPending(false); if (!result.ok) return setNotice(errorText(result.status, result.body?.error)); await load(); }} /> : null}
      {notice ? <p aria-live="polite" className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-xs text-amber-200">{notice}</p> : null}
    </div>
  );
}

function GrantComposer(props: {
  workspaceId: string;
  currentUserId: string;
  members: WorkspaceMemberView[];
  resources: ResourceOption[];
  pending: boolean;
  onCreated: () => Promise<void>;
  onError: (notice: string) => void;
}) {
  const [resourceKey, setResourceKey] = useState("");
  const [scope, setScope] = useState<WorkspaceShareGrantScope>("USER");
  const [granteeUserId, setGranteeUserId] = useState("");
  const [access, setAccess] = useState<WorkspaceShareGrantAccess>("VIEW");
  const [expiresAt, setExpiresAt] = useState("");
  const selectedResource = props.resources.find((item) => item.key === resourceKey);
  const eligibleMembers = props.members.filter((member) =>
    member.status === "ACTIVE" && member.role !== "OWNER" && member.userId !== props.currentUserId);
  const normalizedAccess = scope === "WORKSPACE" ? "VIEW" : access;

  async function submit() {
    if (!selectedResource) return props.onError("请选择要分享的知识资源。");
    if (scope === "USER" && !granteeUserId) return props.onError("请选择目标成员。");
    const result = await createWorkspaceShareGrant(props.workspaceId, {
      resourceType: selectedResource.type,
      resourceId: selectedResource.id,
      scope,
      granteeUserId: scope === "USER" ? granteeUserId : null,
      granteeRole: scope === "ROLE" ? "COACH" : null,
      access: normalizedAccess,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    });
    if (!result.ok) return props.onError(errorText(result.status, result.body?.error));
    setResourceKey(""); setGranteeUserId(""); setExpiresAt(""); await props.onCreated();
  }

  return (
    <Card variant="subtle"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Share2 className="size-4 text-teal-300" />新建分享授权</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">
      <label className="text-xs text-zinc-400">资源<Input list="collaboration-resource-options" value={resourceKey} onChange={(event) => setResourceKey(event.target.value)} placeholder="选择或输入资源" disabled={props.pending} /></label>
      <datalist id="collaboration-resource-options">{props.resources.map((resource) => <option key={resource.key} value={resource.key}>{resource.label}</option>)}</datalist>
      <label className="text-xs text-zinc-400">范围<Select value={scope} onChange={(event) => setScope(event.target.value as WorkspaceShareGrantScope)} disabled={props.pending}><option value="USER">指定成员</option><option value="ROLE">Coach 角色</option><option value="WORKSPACE">当前 Workspace</option></Select></label>
      {scope === "USER" ? <label className="text-xs text-zinc-400">成员<Select value={granteeUserId} onChange={(event) => setGranteeUserId(event.target.value)} disabled={props.pending}><option value="">选择成员</option>{eligibleMembers.map((member) => <option key={member.userId} value={member.userId}>{member.email} · {member.role}</option>)}</Select></label> : null}
      <label className="text-xs text-zinc-400">访问级别<Select value={normalizedAccess} onChange={(event) => setAccess(event.target.value as WorkspaceShareGrantAccess)} disabled={props.pending || scope === "WORKSPACE"}><option value="VIEW">查看</option><option value="COACH">Coach 建议</option></Select></label>
      <label className="text-xs text-zinc-400">过期时间（可选）<Input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} disabled={props.pending} /></label>
      <div className="md:col-span-2"><Button disabled={props.pending} onClick={() => void submit()} type="button"><Link2 className="size-4" />创建授权</Button></div>
    </CardContent></Card>
  );
}

function GrantList(props: {
  grants: WorkspaceShareGrantView[];
  pending: boolean;
  onUpdate: (grant: WorkspaceShareGrantView, input: { expectedRevision: number; access?: WorkspaceShareGrantView["access"]; expiresAt?: string | null }) => Promise<void>;
  onRevoke: (grant: WorkspaceShareGrantView) => Promise<void>;
}) {
  return <section className="space-y-2"><h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">我创建的授权</h4>{props.grants.length === 0 ? <p className="text-xs text-zinc-500">暂无对象级授权。</p> : props.grants.map((grant) => <GrantRow key={grant.id} grant={grant} pending={props.pending} onUpdate={props.onUpdate} onRevoke={props.onRevoke} />)}</section>;
}

function GrantRow(props: {
  grant: WorkspaceShareGrantView;
  pending: boolean;
  onUpdate: (grant: WorkspaceShareGrantView, input: { expectedRevision: number; access?: WorkspaceShareGrantView["access"]; expiresAt?: string | null }) => Promise<void>;
  onRevoke: (grant: WorkspaceShareGrantView) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [access, setAccess] = useState(props.grant.access);
  const [expiresAt, setExpiresAt] = useState(props.grant.expiresAt ? new Date(props.grant.expiresAt).toISOString().slice(0, 16) : "");
  return <div className="rounded-xl border border-white/10 p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0 text-xs"><p className="break-all text-white">{props.grant.resourceType} · {props.grant.resourceId}</p><p className="mt-1 text-zinc-500">{props.grant.scope} · {props.grant.access}{props.grant.revokedAt ? " · 已撤销" : props.grant.expiresAt ? ` · 至 ${new Date(props.grant.expiresAt).toLocaleString()}` : " · 长期"}</p></div>{!props.grant.revokedAt ? <div className="flex flex-wrap gap-2"><Button disabled={props.pending} onClick={() => setEditing((value) => !value)} size="sm" type="button" variant="secondary">{editing ? "取消编辑" : "编辑"}</Button><Button disabled={props.pending} onClick={() => void props.onRevoke(props.grant)} size="sm" type="button" variant="secondary"><UserX className="size-3.5" />撤销</Button></div> : <Badge>已撤销</Badge>}</div>{editing ? <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><label className="text-xs text-zinc-400">访问级别<Select value={access} onChange={(event) => setAccess(event.target.value as WorkspaceShareGrantView["access"])} disabled={props.pending || props.grant.scope === "WORKSPACE"}><option value="VIEW">查看</option><option value="COACH">Coach 建议</option></Select></label><label className="text-xs text-zinc-400">过期时间<Input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} disabled={props.pending} /></label><Button className="self-end" disabled={props.pending} onClick={() => void props.onUpdate(props.grant, { expectedRevision: props.grant.revision, access, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null })} size="sm" type="button">保存</Button></div> : null}</div>;
}

function SharedResourceList(props: { items: SharedResourceView[]; details: Record<string, SharedResourceDetailView>; onOpen: (item: SharedResourceView) => Promise<void> }) {
  return <section className="space-y-2"><h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">与我分享</h4>{props.items.length === 0 ? <p className="text-xs text-zinc-500">暂无有效分享。</p> : props.items.map((item) => { const key = `${item.resourceType}:${item.resourceId}`; const detail = props.details[key]; return <div className="rounded-xl border border-white/10 p-3" key={item.id}><div className="flex flex-wrap items-center justify-between gap-3"><div className="text-xs"><p className="text-white">{item.resourceType} · {item.resourceId}</p><p className="mt-1 text-zinc-500">{item.access} · {item.expiresAt ? `至 ${new Date(item.expiresAt).toLocaleString()}` : "无期限"}</p></div><Button onClick={() => void props.onOpen(item)} size="sm" type="button" variant="secondary">{detail ? "刷新摘要" : "查看共享摘要"}</Button></div>{detail ? <SharedDetail detail={detail} /> : null}</div>; })}</section>;
}

function SharedDetail({ detail }: { detail: SharedResourceDetailView }) {
  if (detail.resourceType === "NOTE") return <div className="mt-3 rounded-lg bg-white/[0.03] p-3 text-xs text-zinc-300"><p className="font-medium text-white">{detail.title} · {detail.subjectName}</p><p className="mt-2 whitespace-pre-wrap">{detail.content}</p></div>;
  if (detail.resourceType === "MISTAKE") return <div className="mt-3 rounded-lg bg-white/[0.03] p-3 text-xs text-zinc-300"><p className="font-medium text-white">{detail.title} · {detail.subjectName}</p><p className="mt-2">{detail.questionText || "未提供题干"}</p><p className="mt-1 text-zinc-500">原因：{detail.cause}</p><p className="mt-1">正确思路：{detail.correctIdea || "未提供"}</p></div>;
  return <div className="mt-3 rounded-lg bg-white/[0.03] p-3 text-xs text-zinc-300"><p className="font-medium text-white">{detail.originalName}</p><p className="mt-1">{detail.mimeType} · {detail.sizeBytes} bytes</p><ButtonLink className="mt-2" href={detail.downloadApiPath} size="sm" variant="secondary">下载附件</ButtonLink></div>;
}

function CoachSuggestionComposer(props: { workspaceId: string; shared: SharedResourceView[]; pending: boolean; onCreated: () => Promise<void>; onError: (notice: string) => void }) {
  const [resourceKey, setResourceKey] = useState("");
  const [title, setTitle] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState(30);
  const selected = props.shared.find((item) => `${item.resourceType}:${item.resourceId}` === resourceKey);
  async function submit() {
    if (!selected || !title.trim()) return props.onError("请选择共享资源并填写建议标题。");
    const result = await createCoachSuggestion({
      workspaceId: props.workspaceId,
      resourceType: selected.resourceType,
      resourceId: selected.resourceId,
      payload: { title: title.trim(), plannedDate: plannedDate ? new Date(plannedDate).toISOString() : null, estimatedMinutes, priority: null, type: "review", subjectId: null, primaryNodeId: null },
    });
    if (!result.ok) return props.onError(errorText(result.status, result.body?.error));
    setResourceKey(""); setTitle(""); setPlannedDate(""); await props.onCreated();
  }
  if (props.shared.length === 0) return null;
  return <Card variant="subtle"><CardHeader><CardTitle className="text-sm">创建 Coach 建议</CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2"><label className="text-xs text-zinc-400">已授权资源<Select value={resourceKey} onChange={(event) => setResourceKey(event.target.value)} disabled={props.pending}><option value="">选择资源</option>{props.shared.filter((item) => item.access === "COACH").map((item) => <option key={item.id} value={`${item.resourceType}:${item.resourceId}`}>{item.resourceType} · {item.resourceId}</option>)}</Select></label><label className="text-xs text-zinc-400">建议标题<Input value={title} onChange={(event) => setTitle(event.target.value)} disabled={props.pending} /></label><label className="text-xs text-zinc-400">计划日期<Input type="datetime-local" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} disabled={props.pending} /></label><label className="text-xs text-zinc-400">预计分钟<Input type="number" min={1} max={1440} value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(Number(event.target.value))} disabled={props.pending} /></label><div className="md:col-span-2"><Button disabled={props.pending} onClick={() => void submit()} type="button"><UserCheck className="size-4" />发送建议</Button></div></CardContent></Card>;
}

function CoachSuggestionList(props: { currentUserId: string; suggestions: CoachSuggestionView[]; pending: boolean; onDecide: (suggestion: CoachSuggestionView, action: "accept" | "reject" | "revoke") => Promise<void> }) {
  return <section className="space-y-2"><h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500"><UserCheck className="size-3.5" />Coach 建议</h4>{props.suggestions.length === 0 ? <p className="text-xs text-zinc-500">暂无建议。</p> : props.suggestions.map((suggestion) => <div className="rounded-xl border border-white/10 p-3" key={suggestion.id}><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm text-white">{suggestion.payload.title}</p><p className="mt-1 text-xs text-zinc-500">{suggestion.status} · {suggestion.sourceResourceType} · {suggestion.sourceResourceId}</p></div><Badge>{suggestion.payload.estimatedMinutes ? `${suggestion.payload.estimatedMinutes} 分钟` : "建议"}</Badge></div>{suggestion.status === "PENDING" ? <div className="mt-3 flex flex-wrap gap-2">{suggestion.recipientUserId === props.currentUserId ? <><Button disabled={props.pending} onClick={() => void props.onDecide(suggestion, "accept")} size="sm" type="button">接受并进入收件箱</Button><Button disabled={props.pending} onClick={() => void props.onDecide(suggestion, "reject")} size="sm" type="button" variant="secondary">驳回</Button></> : null}{suggestion.authorUserId === props.currentUserId ? <Button disabled={props.pending} onClick={() => void props.onDecide(suggestion, "revoke")} size="sm" type="button" variant="secondary">撤回</Button> : null}</div> : null}</div>)}</section>;
}

function buildResourceOptions(notes: Array<{ id: string; title: string; attachments: Array<{ id: string; originalName: string }> }>, mistakes: Array<{ id: string; title: string }>): ResourceOption[] {
  return [
    ...notes.map((note) => ({ key: `NOTE:${note.id}`, type: "NOTE" as const, id: note.id, label: `笔记 · ${note.title}` })),
    ...mistakes.map((mistake) => ({ key: `MISTAKE:${mistake.id}`, type: "MISTAKE" as const, id: mistake.id, label: `错题 · ${mistake.title}` })),
    ...notes.flatMap((note) => note.attachments.map((attachment) => ({ key: `ATTACHMENT:${attachment.id}`, type: "ATTACHMENT" as const, id: attachment.id, label: `附件 · ${attachment.originalName}` }))),
  ];
}

function errorText(status: number, error?: string): string {
  if (status === 0) return "网络连接不可用，请恢复后重试。";
  if (error === "WORKSPACE_SHARE_GRANT_NOT_FOUND" || error === "WORKSPACE_RESOURCE_NOT_FOUND") return "授权或资源已不存在，请刷新后重试。";
  if (error === "WORKSPACE_SHARE_GRANT_CONFLICT" || error === "COACH_SUGGESTION_CONFLICT") return "数据已变化，请刷新后重试。";
  if (error === "WORKSPACE_SHARE_GRANT_TARGET_INVALID") return "分享目标无效，请检查成员和范围。";
  return "操作失败，请刷新后重试。";
}
