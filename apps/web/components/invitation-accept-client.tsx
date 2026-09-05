"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { consumeActionTokenFragment, clearStoredActionToken } from "@/lib/auth/token-fragment";
import { formatDateTime } from "@/lib/formatters";
import {
  acceptWorkspaceInvitation,
  previewWorkspaceInvitation,
  rejectWorkspaceInvitation,
  type WorkspaceInvitationPreviewView,
} from "@/lib/api/workspace-membership";
import { logout as logoutApi } from "@/lib/api/auth-browser";
import { clearPrivateBusinessDrafts } from "@/lib/client/private-business-drafts";
import { clearFocusOfflineData } from "@/lib/client/focus-offline-store";

const invitationTokenStorageKey = "areaforge.workspace-invitation-token";
const invitationLoginHref = "/login?returnTo=%2Finvitations%2Faccept%3Fresume%3D1";

export function InvitationAcceptClient({ currentUser }: { currentUser: { id: string; email: string } | null }) {
  const router = useRouter();
  const tokenRef = useRef("");
  const actionPendingRef = useRef(false);
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<WorkspaceInvitationPreviewView | null>(null);
  const [pending, setPending] = useState(true);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let active = true;
    tokenRef.current = consumeActionTokenFragment(invitationTokenStorageKey);
    async function loadPreview() {
      if (!tokenRef.current) {
        if (active) {
          setNotice("邀请链接无效或缺少一次性凭证。");
          setPending(false);
        }
        return;
      }
      const result = await previewWorkspaceInvitation(tokenRef.current);
      if (!active) return;
      setPreview(result.ok ? result.body?.invitationPreview ?? null : null);
      setNotice(result.ok ? null : result.status === 0 ? "网络连接不可用，请恢复后重试。" : "邀请无效、已使用或已过期。");
      setPending(false);
    }
    void loadPreview();
    return () => { active = false; };
  }, []);
  async function accept() {
    if (actionPendingRef.current) return;
    if (!tokenRef.current) return setNotice("邀请链接无效或缺少一次性凭证。");
    actionPendingRef.current = true;
    setPending(true);
    try {
      const result = await acceptWorkspaceInvitation(tokenRef.current, password || undefined);
      setDone(result.ok);
      if (result.ok) clearStoredActionToken(invitationTokenStorageKey);
      setNotice(result.ok
        ? "邀请已接受，可以进入工作区。"
        : result.status === 0
          ? "网络连接不可用，请恢复后重试。"
          : result.body?.error === "WORKSPACE_INVITATION_CONTINUATION_REQUIRED"
            ? "请使用受邀账户登录，或检查邀请是否仍有效；新账户需要设置符合策略的密码。"
            : "邀请无效、已使用或已过期。");
    } finally {
      actionPendingRef.current = false;
      setPending(false);
    }
  }
  async function reject() {
    if (actionPendingRef.current) return;
    if (!tokenRef.current) return setNotice("邀请链接无效或缺少一次性凭证。");
    actionPendingRef.current = true;
    setPending(true);
    try {
      const result = await rejectWorkspaceInvitation(tokenRef.current);
      setDone(result.ok);
      if (result.ok) clearStoredActionToken(invitationTokenStorageKey);
      setNotice(result.ok
        ? "邀请已拒绝。"
        : result.status === 0
          ? "网络连接不可用，请恢复后重试。"
          : "请使用受邀账户登录，并检查邀请是否仍有效。");
    } finally {
      actionPendingRef.current = false;
      setPending(false);
    }
  }
  async function switchAccount() {
    if (!currentUser || actionPendingRef.current) return;
    actionPendingRef.current = true;
    setPending(true);
    try {
      const result = await logoutApi();
      if (!result.ok) {
        setNotice(result.status === 0 ? "网络连接不可用，请恢复后重试。" : "当前账户退出失败，请稍后重试。");
        return;
      }
      clearPrivateBusinessDrafts();
      await clearFocusOfflineData(currentUser.id);
      router.replace(invitationLoginHref);
      router.refresh();
    } finally {
      actionPendingRef.current = false;
      setPending(false);
    }
  }
  const accountMatchesInvite = !currentUser || !preview
    || currentUser.email.trim().toLowerCase() === preview.invitedEmail.trim().toLowerCase();
  return <div aria-busy={pending} className="space-y-4">{preview ? <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-zinc-300"><p className="break-words font-medium text-white">{preview.workspaceName}</p><p className="mt-1 break-all text-xs text-zinc-400">受邀邮箱：{preview.invitedEmail}</p><p className="mt-1 text-xs text-zinc-500">有效期至：{formatDateTime(preview.expiresAt)}</p></div> : null}{currentUser ? <p className="break-all rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-zinc-400">当前登录：{currentUser.email}{accountMatchesInvite ? "" : "（与受邀邮箱不一致）"}</p> : null}<label className="block text-sm text-zinc-300">仅新账户需要设置密码<Input className="mt-2" disabled={pending || done || Boolean(currentUser)} onChange={(event) => setPassword(event.target.value)} type="password" value={password} /></label><Button disabled={pending || done || !preview || !accountMatchesInvite} fullWidth onClick={accept} type="button">{pending ? "正在处理邀请…" : "接受邀请"}</Button>{currentUser ? <Button disabled={pending || done || !preview || !accountMatchesInvite} fullWidth onClick={reject} type="button" variant="secondary">拒绝邀请</Button> : null}{notice ? <p aria-live="polite" className="text-sm text-zinc-300">{notice}</p> : null}{currentUser ? <Button disabled={pending} fullWidth onClick={switchAccount} type="button" variant="secondary">退出并切换账户</Button> : <Link className="block text-center text-sm text-teal-300" href={invitationLoginHref}>已有账户？先登录</Link>}</div>;
}
