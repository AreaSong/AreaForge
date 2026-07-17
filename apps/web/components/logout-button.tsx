"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("logout_failed");
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
        className="inline-flex h-11 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-300 transition hover:bg-white/10 disabled:opacity-70"
        disabled={pending}
        onClick={logout}
        type="button"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        {pending ? "退出中" : "退出"}
      </button>
      {error ? <p className="text-xs text-rose-200" role="alert">{error}</p> : null}
    </div>
  );
}
