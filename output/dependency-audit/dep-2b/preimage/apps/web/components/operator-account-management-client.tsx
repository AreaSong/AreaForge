"use client";

import { RefreshCw, ShieldCheck, UserRoundCog } from "lucide-react";
import { useState } from "react";
import { reauthenticate } from "@/lib/api/account";
import {
  listOperatorAccounts,
  revokeOperatorAccountSessions,
  updateOperatorAccountStatus,
} from "@/lib/api/operator-account";
import { isConflict } from "@/lib/client/api-errors";
import type { OperatorAccountDto, OperatorAccountReasonCode } from "@/lib/contracts/operator-account";
import { formatDateTime } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Alert, Badge, EmptyState } from "@/components/ui/feedback";

type OperatorAction = "suspend" | "restore" | "revoke-sessions";

const reasons: Array<{ value: OperatorAccountReasonCode; label: string }> = [
  { value: "SECURITY_REVIEW", label: "安全复核" },
  { value: "USER_REQUEST", label: "用户请求" },
  { value: "ABUSE_PREVENTION", label: "滥用防护" },
  { value: "INCIDENT_RESPONSE", label: "事故响应" },
];

export function OperatorAccountManagementClient(props: {
  currentUserId: string;
  initialAccounts: OperatorAccountDto[];
}) {
  const [accounts, setAccounts] = useState(props.initialAccounts);
  const [reason, setReason] = useState<OperatorAccountReasonCode>("SECURITY_REVIEW");
  const [password, setPassword] = useState("");
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setPending("refresh");
    setError(null);
    const result = await listOperatorAccounts();
    setPending(null);
    if (!result.ok) return setError("账户目录读取失败，请重试。");
    setAccounts(result.body?.accounts ?? []);
  }

  async function execute(account: OperatorAccountDto, action: OperatorAction) {
    const key = `${account.id}:${action}`;
    if (armedKey !== key) {
      setArmedKey(key);
      setNotice(confirmMessage(action));
      setError(null);
      return;
    }
    if (!password) return setError("执行敏感账户操作前，请输入当前 Operator 密码重新验证。");
    setPending(key);
    setError(null);
    const verified = await reauthenticate(password);
    if (!verified.ok) {
      setPending(null);
      return setError("重新验证失败，未执行账户操作。");
    }
    setPassword("");
    const result = action === "revoke-sessions"
      ? await revokeOperatorAccountSessions(account.id, reason)
      : await updateOperatorAccountStatus(account.id, {
          status: action === "suspend" ? "SUSPENDED" : "ACTIVE",
          expectedAuthRevision: account.authRevision,
          reason,
        });
    setPending(null);
    setArmedKey(null);
    if (!result.ok) {
      if (isConflict(result)) await refresh();
      return setError(isConflict(result) ? "账户状态已变化，已刷新目录。" : "账户操作失败，未改变本地显示。");
    }
    setNotice(successMessage(action, result.body?.revokedSessionCount));
    await refresh();
  }

  return (
    <SectionCard variant="master" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="flex items-center gap-2 text-base font-semibold text-white"><UserRoundCog className="size-5 text-teal-300" aria-hidden="true" />平台账户目录</h2><p className="mt-1 text-sm text-zinc-400">只显示脱敏邮箱、状态和计数；平台身份不能读取学习正文。</p></div>
        <Button disabled={pending !== null} onClick={() => void refresh()} size="sm" type="button" variant="secondary"><RefreshCw className="size-3.5" aria-hidden="true" />刷新目录</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm text-zinc-300">操作原因<Select className="mt-2" disabled={pending !== null} value={reason} onChange={(event) => setReason(event.target.value as OperatorAccountReasonCode)}>{reasons.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></label>
        <label className="text-sm text-zinc-300">当前 Operator 密码<Input autoComplete="current-password" className="mt-2" disabled={pending !== null} type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      </div>
      {notice ? <Alert tone="success" role="status">{notice}</Alert> : null}
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
      {accounts.length === 0 ? <EmptyState title="没有可显示的账户" description="账户目录为空，或当前 Operator 没有读取权限。" /> : (
        <div className="space-y-3">{accounts.map((account) => <AccountRow key={account.id} account={account} current={account.id === props.currentUserId} armedKey={armedKey} pending={pending} onAction={execute} />)}</div>
      )}
    </SectionCard>
  );
}

function AccountRow(props: {
  account: OperatorAccountDto;
  current: boolean;
  armedKey: string | null;
  pending: string | null;
  onAction: (account: OperatorAccountDto, action: OperatorAction) => Promise<void>;
}) {
  const account = props.account;
  return (
    <article className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-all text-sm font-medium text-white">{account.maskedEmail}</h3><Badge tone={account.status === "ACTIVE" ? "success" : "warning"}>{account.status === "ACTIVE" ? "有效" : "已暂停"}</Badge>{props.current ? <Badge tone="info">当前 Operator</Badge> : null}</div><p className="mt-1 text-xs text-zinc-500">成员关系 {account.activeMembershipCount} · 活动会话 {account.activeSessionCount} · authRevision {account.authRevision}</p><p className="mt-1 text-xs text-zinc-500">更新于 {formatDateTime(account.updatedAt)} · 邮箱{account.emailVerified ? "已验证" : "未验证"}</p></div><ShieldCheck className="size-5 text-zinc-500" aria-hidden="true" /></div>
      {!props.current ? <div className="flex flex-wrap gap-2">{account.status === "ACTIVE" ? <ActionButton account={account} action="suspend" armedKey={props.armedKey} pending={props.pending} onAction={props.onAction} /> : <ActionButton account={account} action="restore" armedKey={props.armedKey} pending={props.pending} onAction={props.onAction} />}<ActionButton account={account} action="revoke-sessions" armedKey={props.armedKey} pending={props.pending} onAction={props.onAction} /></div> : null}
    </article>
  );
}

function ActionButton(props: { account: OperatorAccountDto; action: OperatorAction; armedKey: string | null; pending: string | null; onAction: (account: OperatorAccountDto, action: OperatorAction) => Promise<void> }) {
  const key = `${props.account.id}:${props.action}`;
  const armed = props.armedKey === key;
  return <Button className="min-h-11" disabled={props.pending !== null} onClick={() => void props.onAction(props.account, props.action)} size="sm" type="button" variant={armed ? "primary" : "secondary"}>{props.pending === key ? "处理中…" : armed ? confirmLabel(props.action) : actionLabel(props.action)}</Button>;
}

function actionLabel(action: OperatorAction): string {
  if (action === "suspend") return "暂停账户";
  if (action === "restore") return "恢复账户";
  return "撤销全部会话";
}

function confirmLabel(action: OperatorAction): string {
  if (action === "suspend") return "确认暂停";
  if (action === "restore") return "确认恢复";
  return "确认撤销会话";
}

function confirmMessage(action: OperatorAction): string {
  return `${actionLabel(action)}已进入待确认状态；核对原因并再次点击确认。`;
}

function successMessage(action: OperatorAction, revoked?: number): string {
  return action === "revoke-sessions" ? `会话撤销完成，共处理 ${revoked ?? 0} 个活动会话。` : `${actionLabel(action)}已完成。`;
}
