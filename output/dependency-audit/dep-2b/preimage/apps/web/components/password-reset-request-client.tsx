"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { requestPasswordReset } from "@/lib/api/account";

export function PasswordResetRequestClient() {
  const actionPendingRef = useRef(false);
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit() {
    if (actionPendingRef.current) return;
    if (!email.includes("@")) return setNotice("请输入有效邮箱。");
    actionPendingRef.current = true;
    setPending(true);
    try {
      const result = await requestPasswordReset(email);
      setNotice(result.status === 0
        ? "网络连接不可用，请恢复后重试。"
        : "如果该账户存在且可用，重置邮件会发送到对应邮箱。");
    } finally {
      actionPendingRef.current = false;
      setPending(false);
    }
  }
  return <div aria-busy={pending} className="space-y-4"><label className="block text-sm text-zinc-300">账户邮箱<Input className="mt-2" disabled={pending} onChange={(event) => setEmail(event.target.value)} type="email" value={email} /></label><Button disabled={pending} fullWidth onClick={submit} type="button">{pending ? "正在提交…" : "发送重置邮件"}</Button>{notice ? <p aria-live="polite" className="text-sm text-zinc-300">{notice}</p> : null}<Link className="block text-center text-sm text-teal-300" href="/login">返回登录</Link></div>;
}
