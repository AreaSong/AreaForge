"use client";

import { useState } from "react";
import { Archive, ArrowRightLeft, MailPlus, RefreshCw, RotateCcw, UserMinus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/feedback";
import { reauthenticate } from "@/lib/api/account";
import { activateExamWorkspace, updateExamWorkspace } from "@/lib/api/workspace";
import {
  getWorkspaceInvitations,
  getWorkspaceMembers,
  inviteWorkspaceMember,
  leaveWorkspace,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
  transferWorkspaceOwnership,
  type WorkspaceInvitationView,
  type WorkspaceMemberView,
} from "@/lib/api/workspace-membership";
import type { ExamWorkspaceDto } from "@/lib/contracts/workspace";
import { formatDateTime } from "@/lib/formatters";

export function WorkspaceMembershipClient({
  workspaces,
  multiUserEnabled,
  currentUserId,
}: {
  workspaces: ExamWorkspaceDto[];
  multiUserEnabled: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [managedId, setManagedId] = useState<string | null>(() => workspaces.find((item) => item.current)?.id ?? workspaces[0]?.id ?? null);
  const managed = workspaces.find((item) => item.id === managedId)
    ?? workspaces.find((item) => item.current)
    ?? workspaces[0]
    ?? null;
  const [details, setDetails] = useState<{
    workspaceId: string;
    members: WorkspaceMemberView[];
    invitations: WorkspaceInvitationView[];
  } | null>(null);
  const members = details?.workspaceId === managed?.id ? details.members : [];
  const invitations = details?.workspaceId === managed?.id ? details.invitations : [];
  const [inviteEmail, setInviteEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function loadDetails(workspace: ExamWorkspaceDto) {
    setManagedId(workspace.id);
    setPending(true);
    const [memberResult, invitationResult] = await Promise.all([
      getWorkspaceMembers(workspace.id),
      workspace.membershipRole === "OWNER" ? getWorkspaceInvitations(workspace.id) : Promise.resolve(null),
    ]);
    setPending(false);
    setDetails({
      workspaceId: workspace.id,
      members: memberResult.ok ? memberResult.body?.members ?? [] : [],
      invitations: invitationResult?.ok ? invitationResult.body?.invitations ?? [] : [],
    });
    if (!memberResult.ok) {
      setNotice(memberResult.status === 0
        ? "网络连接不可用，请恢复后重试。"
        : memberResult.body?.error === "MULTI_USER_DISABLED" ? "多人功能当前保持关闭。" : "成员信息暂时无法读取。");
    } else if (workspace.membershipRole === "OWNER" && invitationResult && !invitationResult.ok) {
      setNotice(invitationResult.status === 0 ? "网络连接不可用，请恢复后重试。" : "邀请记录暂时无法读取。");
    }
  }

  async function selectWorkspace(workspace: ExamWorkspaceDto) {
    setPending(true);
    const result = await activateExamWorkspace(workspace.id, workspace.revision, workspace.selectionRevision);
    setPending(false);
    setNotice(result.ok
      ? "当前工作区已切换。"
      : workspaceRequestError(result.status, result.body?.error, "工作区切换失败，请确认没有进行中的学习活动。"));
    if (result.ok) router.refresh();
  }

  async function setArchived(workspace: ExamWorkspaceDto, archived: boolean) {
    setPending(true);
    const result = await updateExamWorkspace(workspace.id, { expectedRevision: workspace.revision, archived });
    setPending(false);
    setNotice(result.ok
      ? archived ? "工作区已归档。" : "工作区已恢复。"
      : workspaceRequestError(result.status, result.body?.error, "工作区状态修改失败。"));
    if (result.ok) router.refresh();
  }

  async function verifyForSensitiveAction(): Promise<boolean> {
    if (!password) {
      setNotice("敏感成员操作前请输入当前账户密码。");
      return false;
    }
    const result = await reauthenticate(password);
    if (!result.ok) setNotice(workspaceRequestError(result.status, result.body?.error, "身份重新验证失败。"));
    return result.ok;
  }

  async function inviteMember() {
    if (!managed || !inviteEmail || !await verifyForSensitiveAction()) return;
    setPending(true);
    const result = await inviteWorkspaceMember(managed.id, inviteEmail);
    setPending(false);
    setNotice(result.ok ? "邀请邮件已发送。" : labelMembershipError(result.body?.error));
    if (result.ok) {
      setInviteEmail("");
      await loadDetails(managed);
    }
  }

  async function revokeInvitation(invitation: WorkspaceInvitationView) {
    if (!managed || !await verifyForSensitiveAction()) return;
    setPending(true);
    const result = await revokeWorkspaceInvitation(managed.id, invitation.id, invitation.revision);
    setPending(false);
    setNotice(result.ok ? "邀请已撤销。" : labelMembershipError(result.body?.error));
    if (result.ok) await loadDetails(managed);
  }

  async function removeMember(member: WorkspaceMemberView) {
    if (!managed || !await verifyForSensitiveAction()) return;
    setPending(true);
    const result = await removeWorkspaceMember(managed.id, member.id, member.revision);
    setPending(false);
    setNotice(result.ok ? "成员已移除。" : labelMembershipError(result.body?.error));
    if (result.ok) await loadDetails(managed);
  }

  async function transferOwner(member: WorkspaceMemberView) {
    if (!managed || !await verifyForSensitiveAction()) return;
    const owner = members.find((item) => item.role === "OWNER" && item.status === "ACTIVE");
    if (!owner) return setNotice("当前 Owner 状态不可用。");
    setPending(true);
    const result = await transferWorkspaceOwnership(managed.id, {
      targetMembershipId: member.id,
      expectedOwnerRevision: owner.revision,
      expectedTargetRevision: member.revision,
    });
    setPending(false);
    setNotice(result.ok ? "所有权已转移。" : labelMembershipError(result.body?.error));
    if (result.ok) router.refresh();
  }

  async function leave(workspace: ExamWorkspaceDto, membership: WorkspaceMemberView) {
    if (!await verifyForSensitiveAction()) return;
    setPending(true);
    const result = await leaveWorkspace(workspace.id, membership.revision);
    setPending(false);
    setNotice(result.ok ? "已离开工作区。" : labelMembershipError(result.body?.error));
    if (result.ok) router.refresh();
  }

  if (!multiUserEnabled) {
    return <Card variant="master"><CardContent className="p-5 text-sm text-zinc-300">多人能力已安装但默认关闭。完成隔离验证并在目标环境显式设置 <code>AUTH_MULTI_USER_ENABLED=true</code> 后，邀请和成员入口才会开放。</CardContent></Card>;
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
      <div className="space-y-3">
        {workspaces.map((workspace) => (
          <Card key={workspace.id} variant={workspace.current ? "master" : "subtle"}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><p className="break-words font-medium text-white">{workspace.name}</p><p className="mt-1 break-all text-xs text-zinc-500">{workspace.stableKey}</p></div>
                <div className="flex gap-2"><Badge>{workspace.membershipRole === "OWNER" ? "Owner" : "Member"}</Badge>{workspace.current ? <Badge tone="success">当前</Badge> : null}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={pending} onClick={() => loadDetails(workspace)} size="sm" type="button" variant="secondary"><Users className="size-3.5" />成员</Button>
                {workspace.membershipRole === "OWNER" && workspace.status === "ACTIVE" && !workspace.current ? <Button disabled={pending} onClick={() => selectWorkspace(workspace)} size="sm" type="button" variant="secondary"><ArrowRightLeft className="size-3.5" />切换</Button> : null}
                {workspace.membershipRole === "OWNER" ? <Button disabled={pending} onClick={() => setArchived(workspace, workspace.status === "ACTIVE")} size="sm" type="button" variant="secondary">{workspace.status === "ACTIVE" ? <Archive className="size-3.5" /> : <RotateCcw className="size-3.5" />}{workspace.status === "ACTIVE" ? "归档" : "恢复"}</Button> : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card variant="master">
        <CardHeader><CardTitle>{managed ? `${managed.name} · 成员管理` : "选择工作区"}</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          {managed ? <Button disabled={pending} onClick={() => loadDetails(managed)} size="sm" type="button" variant="secondary"><RefreshCw className="size-3.5" />读取成员</Button> : null}
          {managed ? <label className="block text-sm text-zinc-300">敏感成员操作验证<Input autoComplete="current-password" className="mt-2" onChange={(event) => setPassword(event.target.value)} type="password" value={password} /></label> : null}
          {members.map((member) => (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 p-3" key={member.id}>
              <div className="min-w-0"><p className="break-all text-sm text-white">{member.email}</p><p className="mt-1 text-xs text-zinc-500">{member.role} · {member.status}</p></div>
              {managed?.membershipRole === "OWNER" && member.role === "MEMBER" && member.status === "ACTIVE" ? <div className="flex gap-2"><Button disabled={pending} onClick={() => transferOwner(member)} size="sm" type="button" variant="secondary">转移所有权</Button><Button disabled={pending} onClick={() => removeMember(member)} size="sm" type="button" variant="secondary"><UserMinus className="size-3.5" />移除</Button></div> : null}
              {managed?.membershipRole === "MEMBER" && member.userId === currentUserId ? <Button disabled={pending} onClick={() => leave(managed, member)} size="sm" type="button" variant="secondary">离开</Button> : null}
            </div>
          ))}
          {managed?.membershipRole === "OWNER" && managed.status === "ACTIVE" ? <div className="space-y-3 border-t border-white/10 pt-5">
            <label className="block text-sm text-zinc-300">邀请邮箱<Input className="mt-2" onChange={(event) => setInviteEmail(event.target.value)} type="email" value={inviteEmail} /></label>
            <Button disabled={pending} onClick={inviteMember} type="button"><MailPlus className="size-4" />重新验证并邀请</Button>
            {invitations.map((invitation) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 p-3" key={invitation.id}><div className="min-w-0"><p className="break-all text-sm text-white">{invitation.email}</p><p className="text-xs text-zinc-500">{invitation.status} · 至 {formatDateTime(invitation.expiresAt)}</p></div>{invitation.status === "PENDING" ? <Button disabled={pending} onClick={() => revokeInvitation(invitation)} size="sm" type="button" variant="secondary">撤销</Button> : null}</div>)}
          </div> : null}
          {notice ? <p aria-live="polite" className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-zinc-300">{notice}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function labelMembershipError(error?: string): string {
  if (error === "REAUTHENTICATION_REQUIRED") return "请先重新验证身份。";
  if (error === "WORKSPACE_MEMBER_ALREADY_EXISTS") return "该账户已经是成员。";
  if (error === "PERSONAL_WORKSPACE_REQUIRED") return "请先保留另一个个人工作区，再转移所有权。";
  if (error === "AUTH_MAIL_DELIVERY_FAILED") return "邮件投递失败，邀请已自动撤销。";
  return "操作失败，数据可能已变化，请刷新后重试。";
}

function workspaceRequestError(status: number, error: string | undefined, fallback: string): string {
  if (status === 0) return "网络连接不可用，请恢复后重试。";
  if (status === 429) return "尝试次数过多，请稍后再试。";
  return labelMembershipError(error) === "操作失败，数据可能已变化，请刷新后重试。"
    ? fallback
    : labelMembershipError(error);
}
