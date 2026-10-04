"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { resetPassword } from "@/lib/api/account";
import { consumeActionTokenFragment } from "@/lib/auth/token-fragment";

export function TokenPasswordResetClient() {
  const tokenRef = useRef("");
  const actionPendingRef = useRef(false);
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    tokenRef.current = consumeActionTokenFragment();
  }, []);
  async function submit() {
    if (actionPendingRef.current) return;
    if (!tokenRef.current) return setNotice("链接无效或缺少一次性凭证。");
    actionPendingRef.current = true;
    setPending(true);
    try {
      const result = await resetPassword(tokenRef.current, password);
      setDone(result.ok);
      setNotice(result.ok
        ? "密码已重置，所有旧会话均已撤销。"
        : result.status === 0
          ? "网络连接不可用，请恢复后重试。"
          : result.body?.error === "PASSWORD_POLICY_NOT_SATISFIED"
            ? "新密码至少 12 位，并包含四类字符中的三类。"
            : "链接无效、已使用或已过期。");
    } finally {
      actionPendingRef.current = false;
      setPending(false);
    }
  }
  return <div aria-busy={pending} className="space-y-4"><label className="block text-sm text-zinc-300">新密码<Input className="mt-2" disabled={pending || done} onChange={(event) => setPassword(event.target.value)} type="password" value={password} /></label><p className="text-xs text-zinc-500">至少 12 位，包含四类字符中的三类。</p><Button disabled={pending || done} fullWidth onClick={submit} type="button">{pending ? "正在重置…" : "重置密码"}</Button>{notice ? <p aria-live="polite" className="text-sm text-zinc-300">{notice}</p> : null}{done ? <Link className="block text-center text-sm text-teal-300" href="/login">使用新密码登录</Link> : null}</div>;
}
