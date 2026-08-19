"use client";

import { type FormEvent, useState } from "react";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";

export interface LoginFormProps {
  returnTo?: string;
  className?: string;
}

export function LoginForm({ returnTo = "/today", className = "" }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isCapsLockOn, setIsCapsLockOn] = useState(false);
  const [autofillSuccess, setAutofillSuccess] = useState(false);

  function handleKeyActivity(event: React.KeyboardEvent<HTMLInputElement>) {
    if (typeof event.getModifierState === "function") {
      setIsCapsLockOn(event.getModifierState("CapsLock"));
    }
  }

  function handleAutofillDemo() {
    setEmail("admin@areasong.local");
    setPassword("admin@areasong.local");
    setError(null);
    setAutofillSuccess(true);
    window.setTimeout(() => setAutofillSuccess(false), 3000);
  }

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!email || !email.includes("@")) {
      setError("请输入有效的邮箱地址。");
      return;
    }

    if (!password) {
      setError("请输入账户密码。");
      return;
    }

    setPending(true);

    let response: Response;
    try {
      response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      setPending(false);
      setError("服务暂时不可用，请检查网络后重试。");
      return;
    }

    setPending(false);

    if (!response.ok) {
      if (response.status === 401) setError("邮箱或密码不正确。");
      else if (response.status === 429) setError("失败次数过多，请稍后再试。");
      else if (response.status >= 500) setError("系统暂时不可用，请稍后重试。");
      else setError("暂时无法登录，请检查凭证后重试。");
      return;
    }

    router.replace(returnTo);
    router.refresh();
  }

  return (
    <div
      className={`relative w-full rounded-[1.75rem] border border-white/[0.1] bg-[#121817]/95 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.5)] backdrop-blur-xl sm:p-8 ${className}`.trim()}
    >
      <div className="mb-7">
        <span className="inline-flex items-center gap-2 text-xs font-medium text-teal-200">
          <span aria-hidden className="size-1.5 rounded-full bg-teal-300" />
          继续你的学习闭环
        </span>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-white">登录 AreaForge</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">进入你的个人学习工作区，继续今天的行动。</p>
      </div>

      <form aria-busy={pending} className="space-y-5" noValidate onSubmit={submitAccount}>
        <div>
          <label className="mb-2 block text-sm font-medium text-zinc-300" htmlFor="email">
            邮箱
          </label>
          <div className="group relative">
            <Mail aria-hidden className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500 transition-colors group-focus-within:text-teal-300" />
            <input
              aria-describedby={error ? "login-error" : undefined}
              aria-invalid={Boolean(error)}
              autoComplete="email"
              className="h-12 w-full rounded-xl border border-white/[0.09] bg-black/20 pl-10 pr-4 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 hover:border-white/15 focus:border-teal-300/60 focus:bg-teal-200/[0.025] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={pending}
              id="email"
              inputMode="email"
              name="email"
              onChange={(event) => {
                setEmail(event.target.value);
                if (error) setError(null);
              }}
              placeholder="name@example.com"
              type="email"
              value={email}
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-zinc-300" htmlFor="password">
            密码
          </label>
          <div className="group relative">
            <LockKeyhole aria-hidden className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500 transition-colors group-focus-within:text-teal-300" />
            <input
              aria-describedby={error ? "login-error" : undefined}
              aria-invalid={Boolean(error)}
              autoComplete="current-password"
              className="h-12 w-full rounded-xl border border-white/[0.09] bg-black/20 pl-10 pr-11 text-sm text-white outline-none transition-colors placeholder:text-zinc-600 hover:border-white/15 focus:border-teal-300/60 focus:bg-teal-200/[0.025] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={pending}
              id="password"
              name="password"
              onBlur={() => setIsCapsLockOn(false)}
              onChange={(event) => {
                setPassword(event.target.value);
                if (error) setError(null);
              }}
              onKeyDown={handleKeyActivity}
              onKeyUp={handleKeyActivity}
              placeholder="输入账户密码"
              type={showPassword ? "text" : "password"}
              value={password}
            />
            <button
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
              className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300 focus-visible:ring-2 focus-visible:ring-teal-300 disabled:opacity-50"
              disabled={pending}
              onClick={() => setShowPassword((visible) => !visible)}
              type="button"
            >
              {showPassword ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
            </button>
          </div>

          {isCapsLockOn ? (
            <p aria-live="polite" className="mt-2 flex items-center gap-1.5 text-xs text-amber-300" role="status">
              <ShieldAlert aria-hidden className="size-3.5 shrink-0" />
              大写锁定已开启
            </p>
          ) : null}
        </div>

        <div className="min-h-10" id="login-status">
          {error ? (
            <p
              aria-atomic="true"
              aria-live="assertive"
              className="rounded-xl border border-red-400/25 bg-red-400/[0.08] px-3 py-2.5 text-xs leading-5 text-red-200"
              id="login-error"
              role="alert"
            >
              {error}
            </p>
          ) : autofillSuccess ? (
            <p aria-live="polite" className="flex items-center gap-2 px-1 py-2 text-xs text-teal-200" role="status">
              <Check aria-hidden className="size-3.5" />
              演示账号已填入，可以直接登录。
            </p>
          ) : (
            <p className="px-1 py-2 text-xs text-zinc-600">当前仅支持邮箱与密码登录。</p>
          )}
        </div>

        <button
          className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-300 font-medium text-[#06211d] shadow-[0_12px_30px_rgba(45,212,191,0.12)] transition-colors hover:bg-teal-200 focus-visible:ring-2 focus-visible:ring-teal-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#121817] disabled:cursor-not-allowed disabled:opacity-55"
          disabled={pending}
          type="submit"
        >
          {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
          <span>{pending ? "正在登录…" : "登录并继续学习"}</span>
          {!pending ? <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" /> : null}
        </button>
      </form>

      <div className="mt-6 border-t border-white/[0.07] pt-5">
        <button
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.1] px-3 py-2.5 text-xs text-zinc-500 transition-colors hover:border-teal-200/25 hover:bg-teal-200/[0.035] hover:text-teal-100 focus-visible:ring-2 focus-visible:ring-teal-300"
          onClick={handleAutofillDemo}
          type="button"
        >
          <Sparkles aria-hidden className="size-3.5" />
          {autofillSuccess ? "演示账号已填入" : "填入本地演示账号"}
        </button>
      </div>
    </div>
  );
}
