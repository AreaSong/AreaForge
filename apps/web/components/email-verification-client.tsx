"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { verifyEmail } from "@/lib/api/account";
import { consumeActionTokenFragment } from "@/lib/auth/token-fragment";

export function EmailVerificationClient() {
  const tokenRef = useRef("");
  const actionPendingRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    tokenRef.current = consumeActionTokenFragment();
  }, []);
  async function submit() {
    if (actionPendingRef.current) return;
    if (!tokenRef.current) return setNotice("验证链接无效或缺少一次性凭证。");
    actionPendingRef.current = true;
    setPending(true);
    try {
      const result = await verifyEmail(tokenRef.current);
      setDone(result.ok);
      setNotice(result.ok ? "邮箱已验证。" : result.status === 0 ? "网络连接不可用，请恢复后重试。" : "验证链接无效、已使用或已过期。");
    } finally {
      actionPendingRef.current = false;
      setPending(false);
    }
  }
  return <div aria-busy={pending} className="space-y-4"><Button disabled={pending || done} fullWidth onClick={submit} type="button">{pending ? "正在验证…" : "验证邮箱"}</Button>{notice ? <p aria-live="polite" className="text-sm text-zinc-300">{notice}</p> : null}<Link className="block text-center text-sm text-teal-300" href="/settings/account">返回账户安全</Link></div>;
}
