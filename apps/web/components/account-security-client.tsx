"use client";

import { useState } from "react";
import { KeyRound, Laptop, MailCheck, RefreshCw, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/feedback";
import {
  changePassword,
  getDeviceSessions,
  reauthenticate,
  requestEmailVerification,
  revokeDeviceSession,
  revokeOtherDeviceSessions,
  type AuthSessionView,
} from "@/lib/api/account";
import { formatDateTime } from "@/lib/formatters";

export function AccountSecurityClient({
  email,
  emailVerifiedAt,
  initialSessions,
  status,
}: {
  email: string;
  emailVerifiedAt: string | null;
  initialSessions: AuthSessionView[];
  status: "ACTIVE" | "SUSPENDED";
}) {
  const [sessions, setSessions] = useState(initialSessions);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function refreshSessions() {
    setPending(true);
    const result = await getDeviceSessions();
    setPending(false);
    if (result.ok && result.body?.sessions) setSessions(result.body.sessions);
    else setNotice(accountRequestError(result.status, result.body?.error, "无法刷新设备会话，请稍后重试。"));
  }

  async function confirmIdentity() {
    if (!currentPassword) return setNotice("请输入当前密码。");
    setPending(true);
    const result = await reauthenticate(currentPassword);
    setPending(false);
    setNotice(result.ok
      ? "身份已重新验证，敏感操作窗口有效 10 分钟。"
      : accountRequestError(result.status, result.body?.error, "当前密码不正确。"));
    if (result.ok) await refreshSessions();
  }

  async function submitPasswordChange() {
    if (!currentPassword || !nextPassword) return setNotice("请填写当前密码和新密码。");
    setPending(true);
    const result = await changePassword(currentPassword, nextPassword);
    setPending(false);
    if (!result.ok) {
      setNotice(result.status === 0
        ? "网络连接不可用，请恢复后重试。"
        : result.status === 429
          ? "尝试次数过多，请稍后再试。"
          : result.body?.error === "PASSWORD_POLICY_NOT_SATISFIED"
        ? "新密码至少 12 位，并包含四类字符中的三类。"
        : "密码修改失败，请核对当前密码后重试。");
      return;
    }
    setCurrentPassword("");
    setNextPassword("");
    setNotice("密码已修改，其他设备会话已撤销。");
    await refreshSessions();
  }

  async function revokeSession(id: string) {
    setPending(true);
    const result = await revokeDeviceSession(id);
    setPending(false);
    if (!result.ok) return setNotice(accountRequestError(result.status, result.body?.error, "会话撤销失败。"));
    setNotice("设备会话已撤销。");
    await refreshSessions();
  }

  async function revokeOthers() {
    setPending(true);
    const result = await revokeOtherDeviceSessions();
    setPending(false);
    if (!result.ok) return setNotice(accountRequestError(result.status, result.body?.error, "批量撤销失败。"));
    setNotice(`已撤销 ${result.body?.revokedSessionCount ?? 0} 个其他设备会话。`);
    await refreshSessions();
  }

  async function sendVerification() {
    setPending(true);
    const result = await requestEmailVerification();
    setPending(false);
    setNotice(result.ok
      ? "验证邮件已提交发送，请检查邮箱。"
      : accountRequestError(result.status, result.body?.error, "验证邮件暂时无法发送。"));
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
      <div className="space-y-6">
        <Card variant="master">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-teal-300" />账户身份</CardTitle>
              <div className="flex flex-wrap gap-2"><Badge tone={status === "ACTIVE" ? "success" : "warning"}>{status === "ACTIVE" ? "账户正常" : "账户已暂停"}</Badge><Badge tone={emailVerifiedAt ? "success" : "warning"}>{emailVerifiedAt ? "邮箱已验证" : "邮箱待验证"}</Badge></div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="break-all rounded-xl border border-white/10 bg-black/20 px-3 py-2 font-mono text-sm text-zinc-200">{email}</p>
            {emailVerifiedAt ? <p className="text-xs text-zinc-400">验证时间：{formatDateTime(emailVerifiedAt)}</p> : (
              <Button disabled={pending} onClick={sendVerification} type="button"><MailCheck className="size-4" />发送验证邮件</Button>
            )}
          </CardContent>
        </Card>

        <Card variant="master">
          <CardHeader><CardTitle className="flex items-center gap-2"><Laptop className="size-4 text-teal-300" />设备会话</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {sessions.map((session) => (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3" key={session.id}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{session.deviceLabel} {session.current ? <Badge tone="success">当前</Badge> : null}</p>
                  <p className="mt-1 text-xs text-zinc-500">最近活动：{formatDateTime(session.lastSeenAt ?? session.createdAt)}</p>
                </div>
                {session.current ? null : <Button disabled={pending} onClick={() => revokeSession(session.id)} size="sm" type="button" variant="secondary"><X className="size-3.5" />撤销</Button>}
              </div>
            ))}
            <div className="flex flex-wrap gap-2"><Button disabled={pending} onClick={refreshSessions} size="sm" type="button" variant="secondary"><RefreshCw className="size-3.5" />刷新会话</Button><Button disabled={pending} onClick={revokeOthers} size="sm" type="button" variant="secondary">撤销其他设备</Button></div>
          </CardContent>
        </Card>
      </div>

      <Card variant="master" className="h-fit">
        <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="size-4 text-teal-300" />密码与重新验证</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <label className="block text-sm text-zinc-300">当前密码<Input autoComplete="current-password" className="mt-2" onChange={(event) => setCurrentPassword(event.target.value)} type="password" value={currentPassword} /></label>
          <Button disabled={pending} onClick={confirmIdentity} type="button" variant="secondary">重新验证身份</Button>
          <div className="border-t border-white/10 pt-4">
            <label className="block text-sm text-zinc-300">新密码<Input autoComplete="new-password" className="mt-2" onChange={(event) => setNextPassword(event.target.value)} type="password" value={nextPassword} /></label>
            <p className="mt-2 text-xs text-zinc-500">至少 12 位，需包含大写、小写、数字、符号中的三类。</p>
            <Button className="mt-4" disabled={pending} onClick={submitPasswordChange} type="button">修改密码并撤销其他会话</Button>
          </div>
          {notice ? <p aria-live="polite" className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-zinc-300">{notice}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function accountRequestError(status: number, error: string | undefined, fallback: string): string {
  if (status === 0) return "网络连接不可用，请恢复后重试。";
  if (status === 429) return "尝试次数过多，请稍后再试。";
  if (error === "REAUTHENTICATION_REQUIRED") return "请先重新验证身份。";
  return fallback;
}
