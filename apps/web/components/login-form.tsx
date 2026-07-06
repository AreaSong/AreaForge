"use client";

import { Flame, Loader2, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    });

    setPending(false);

    if (!response.ok) {
      setError(response.status === 429 ? "失败次数过多，稍后再试。" : "邮箱或密码不正确。");
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <form className="w-full max-w-sm rounded-lg border border-white/10 bg-[#101419] p-6" onSubmit={submit}>
      <div className="flex items-center gap-3 text-teal-300">
        <Flame className="h-5 w-5" aria-hidden="true" />
        <span className="text-sm">AreaForge</span>
      </div>
      <h1 className="mt-5 text-2xl font-semibold text-white">进入作战台</h1>

      <label className="mt-6 block text-sm text-zinc-300" htmlFor="email">
        邮箱
      </label>
      <input
        autoComplete="email"
        className="mt-2 h-11 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-white outline-none transition focus:border-teal-300"
        id="email"
        name="email"
        required
        type="email"
      />

      <label className="mt-4 block text-sm text-zinc-300" htmlFor="password">
        密码
      </label>
      <input
        autoComplete="current-password"
        className="mt-2 h-11 w-full rounded-md border border-white/10 bg-[#151a20] px-3 text-white outline-none transition focus:border-teal-300"
        id="password"
        name="password"
        required
        type="password"
      />

      {error ? <p className="mt-4 text-sm text-red-200">{error}</p> : null}

      <button
        className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-teal-400 font-medium text-[#071011] transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={pending}
        type="submit"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LockKeyhole className="h-4 w-4" aria-hidden="true" />}
        登录
      </button>
    </form>
  );
}
