"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Modal } from "@/components/ui/overlays";
import { clearPrivateBusinessDrafts } from "@/lib/client/private-business-drafts";
import { clearFocusOfflineData } from "@/lib/client/focus-offline-store";

export function LogoutButton({ compact = false, userId }: { compact?: boolean; userId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function logout() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("logout_failed");
      clearPrivateBusinessDrafts();
      await clearFocusOfflineData(userId);
      setConfirmOpen(false);
      router.replace("/login");
      router.refresh();
    } catch {
      setError("退出失败，请重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid justify-items-start gap-1">
      <button
        className={`inline-flex h-11 items-center justify-center gap-2 rounded-md border border-white/10 text-sm text-zinc-300 transition hover:bg-white/10 disabled:opacity-70 ${compact ? "w-11 px-0" : "px-3"}`}
        disabled={pending}
        onClick={() => setConfirmOpen(true)}
        type="button"
        title={compact ? "退出登录" : undefined}
        aria-label={compact ? "退出登录" : undefined}
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        <span className={compact ? "sr-only" : undefined}>{pending ? "退出中" : "退出"}</span>
      </button>
      {error ? <p className="text-xs text-rose-200" role="alert">{error}</p> : null}
      <Modal open={confirmOpen} title="退出登录" allowEscape={false} onClose={() => setConfirmOpen(false)}>
        <p className="text-sm leading-6 text-zinc-300">退出成功后会清除当前设备上的未提交私密业务草稿；服务端已保存记录不受影响。</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="h-10 rounded-md border border-white/10 px-3 text-sm text-zinc-300" onClick={() => setConfirmOpen(false)}>取消</button>
          <button type="button" disabled={pending} className="h-10 rounded-md bg-rose-400 px-3 text-sm font-medium text-black disabled:opacity-60" onClick={() => void logout()}>{pending ? "退出中" : "确认退出"}</button>
        </div>
      </Modal>
    </div>
  );
}
