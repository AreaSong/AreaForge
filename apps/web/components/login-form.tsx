"use client";

import React, { FormEvent, useState } from "react";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Github,
  Key,
  Loader2,
  LockKeyhole,
  Mail,
  MessageCircle,
  ShieldAlert,
  Sparkles,
  UserCheck,
  Wand2,
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
  const [shakeError, setShakeError] = useState(false);
  const [autofillSuccess, setAutofillSuccess] = useState(false);

  // Mouse spotlight cursor tracking
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    e.currentTarget.style.setProperty("--mouse-x", `${x}px`);
    e.currentTarget.style.setProperty("--mouse-y", `${y}px`);
  };

  // CapsLock Status Detection
  const handleKeyActivity = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === "function") {
      setIsCapsLockOn(e.getModifierState("CapsLock"));
    }
  };

  // 1-Click Demo Account Quick Autofill
  const handleAutofillDemo = () => {
    setEmail("admin@areasong.local");
    setPassword("admin@areasong.local");
    setError(null);
    setAutofillSuccess(true);
    setTimeout(() => setAutofillSuccess(false), 3000);
  };

  // Trigger error shake animation
  const triggerShake = (errMsg: string) => {
    setError(errMsg);
    setShakeError(true);
    setTimeout(() => setShakeError(false), 500);
  };

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    if (!email || !email.includes("@")) {
      setPending(false);
      triggerShake("请输入有效的邮箱格式。");
      return;
    }

    if (!password) {
      setPending(false);
      triggerShake("请输入账户密码。");
      return;
    }

    let response: Response;
    try {
      response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });
    } catch {
      setPending(false);
      triggerShake("服务暂时不可用，请检查网络后重试。");
      return;
    }

    setPending(false);

    if (!response.ok) {
      if (response.status === 401) triggerShake("邮箱或密码不正确。");
      else if (response.status === 429) triggerShake("失败次数过多，稍后再试。");
      else if (response.status >= 500) triggerShake("系统暂时不可用，请稍后重试。");
      else triggerShake("连接未建立，请检查凭证。");
      return;
    }

    router.replace(returnTo);
    router.refresh();
  }

  function handleDummySubmit(event: React.MouseEvent) {
    if ("preventDefault" in event) event.preventDefault();
    setError("当前版本受限，更多通道将于后续版本开放。");
  }

  return (
    <div
      onMouseMove={handleMouseMove}
      className={`group/card relative w-full max-w-[400px] mx-auto select-none rounded-2xl border border-white/[0.08] bg-[#18191c]/90 p-6 sm:p-8 shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-2xl transition-all duration-300 ${
        shakeError ? "af-shake-error ring-2 ring-red-500/50" : ""
      } ${className}`.trim()}
    >
      {/* Mouse Spotlight Layer */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-px rounded-2xl opacity-0 transition-opacity duration-300 group-hover/card:opacity-100"
        style={{
          background: `radial-gradient(450px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), rgba(45, 212, 191, 0.12), transparent 60%)`,
        }}
      />

      {/* Header */}
      <div className="mb-6 text-center relative z-10">
        <div className="mb-2 inline-flex items-center justify-center gap-1.5 font-mono text-[10px] font-bold tracking-[0.25em] text-teal-400 uppercase">
          <span className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-pulse shadow-[0_0_8px_currentColor]" />
          通行证认证
        </div>
        <h1 className="text-2xl font-black tracking-tight text-white drop-shadow-md sm:text-3xl">
          登录 AreaForge
        </h1>
        <p className="mt-1.5 text-xs text-zinc-400 font-mono tracking-wide">
          面向个人长期备考的自我锻造中枢
        </p>
      </div>

      {/* 1-Click Demo Quick Fill Banner Button */}
      <div className="mb-5 relative z-10">
        <button
          type="button"
          onClick={handleAutofillDemo}
          className="flex w-full items-center justify-between rounded-xl border border-teal-500/30 bg-teal-950/30 px-3.5 py-2 text-xs text-teal-300 transition-all hover:border-teal-400 hover:bg-teal-500/20 hover:shadow-[0_0_16px_rgba(45,212,191,0.15)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 cursor-pointer"
        >
          <span className="flex items-center gap-2 font-mono font-medium text-[11px]">
            <Sparkles className="size-3.5 text-teal-400" />
            一键填入演示账号 (Demo)
          </span>
          <span className="font-mono text-[10px] text-teal-400 font-bold inline-flex items-center">
            {autofillSuccess ? (
              <>
                <Check className="size-3.5 inline mr-1 text-emerald-400" />
                <span>已就绪</span>
              </>
            ) : (
              "admin@local"
            )}
          </span>
        </button>
      </div>

      {/* Primary Login Form: Email & Password */}
      <form className="relative z-10 space-y-4" onSubmit={submitAccount}>
        {/* Email Field */}
        <div>
          <label className="sr-only" htmlFor="email">邮箱</label>
          <div className="group relative">
            <Mail className="absolute left-3.5 top-[14px] size-4 text-zinc-500 transition-colors group-focus-within:text-teal-400" />
            <input
              autoComplete="email"
              className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#121316]/90 backdrop-blur-md pl-10 pr-4 text-sm text-white outline-none transition-all placeholder:text-zinc-500 hover:border-white/20 focus:border-teal-400 focus:bg-white/[0.04] focus:shadow-[0_0_16px_rgba(45,212,191,0.18)]"
              id="email"
              name="email"
              placeholder="邮箱地址 (Email)"
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={handleKeyActivity}
              onKeyUp={handleKeyActivity}
              disabled={pending}
            />
          </div>
        </div>

        {/* Password Field */}
        <div>
          <label className="sr-only" htmlFor="password">密码</label>
          <div className="group relative">
            <LockKeyhole className="absolute left-3.5 top-[14px] size-4 text-zinc-500 transition-colors group-focus-within:text-teal-400" />
            <input
              autoComplete="current-password"
              className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#121316]/90 backdrop-blur-md pl-10 pr-10 text-sm text-white outline-none transition-all placeholder:text-zinc-500 hover:border-white/20 focus:border-teal-400 focus:bg-white/[0.04] focus:shadow-[0_0_16px_rgba(45,212,191,0.18)]"
              id="password"
              name="password"
              placeholder="账户密码 (Password)"
              required
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handleKeyActivity}
              onKeyUp={handleKeyActivity}
              disabled={pending}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-[7px] p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors rounded-lg hover:bg-white/5 outline-none focus-visible:ring-2 focus-visible:ring-teal-400 cursor-pointer"
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
              disabled={pending}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>

          {/* CapsLock Warning Badge */}
          {isCapsLockOn && (
            <div
              role="alert"
              aria-live="polite"
              className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-400 font-mono animate-fade-in"
            >
              <ShieldAlert className="size-3.5 shrink-0" />
              <span>[WARN] 大写锁定已开启 (CapsLock ON)</span>
            </div>
          )}
        </div>

        {/* Error Alert Banner */}
        <div className="min-h-[38px] flex items-center justify-center">
          {error ? (
            <p
              aria-atomic="true"
              aria-live="assertive"
              className="flex w-full items-center justify-center rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400 font-mono"
              role="alert"
            >
              [ERR] {error}
            </p>
          ) : autofillSuccess ? (
            <p className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 font-mono animate-fade-in">
              <UserCheck className="size-3.5" /> 演示凭证已填充，点击登录即可进入
            </p>
          ) : null}
        </div>

        {/* Submit Button */}
        <button
          className="group relative flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-teal-500/20 font-mono text-sm font-bold tracking-[0.12em] text-teal-300 border border-teal-500/40 transition-all hover:bg-teal-500 hover:text-[#121316] hover:border-teal-400 hover:shadow-[0_0_20px_rgba(45,212,191,0.4)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 disabled:cursor-not-allowed disabled:opacity-50 overflow-hidden cursor-pointer"
          disabled={pending}
          type="submit"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin text-teal-400 group-hover:text-[#121316]" aria-hidden="true" />
          ) : (
            <ArrowRight className="size-4 text-teal-400 group-hover:text-[#121316] transition-transform group-hover:translate-x-0.5" />
          )}
          <span className="relative z-10">
            {pending ? "正在验证通行凭证..." : "进入 AreaForge 工作区"}
          </span>
        </button>
      </form>

      {/* Divider */}
      <div className="my-6 flex items-center gap-3 opacity-40 relative z-10">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/20 to-white/20" />
        <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-zinc-400">
          其他登录方式
        </span>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent via-white/20 to-white/20" />
      </div>

      {/* Alternative Login Options */}
      <div className="space-y-2 relative z-10">
        <button
          type="button"
          onClick={handleDummySubmit}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] text-xs font-medium text-zinc-400 transition-all hover:border-cyan-500/30 hover:bg-cyan-500/10 hover:text-cyan-300 cursor-pointer"
        >
          <Wand2 className="size-3.5 text-zinc-500 group-hover:text-cyan-400 transition-colors" />
          免密登录链接 (Magic Link)
        </button>

        <button
          type="button"
          onClick={handleDummySubmit}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] text-xs font-medium text-zinc-400 transition-all hover:border-amber-500/30 hover:bg-amber-500/10 hover:text-amber-300 cursor-pointer"
        >
          <Key className="size-3.5 text-zinc-500 group-hover:text-amber-400 transition-colors" />
          备用安全密钥 (Security Key)
        </button>
      </div>

      {/* SSO Links */}
      <div className="mt-3 flex justify-center gap-2 relative z-10">
        <button
          type="button"
          onClick={handleDummySubmit}
          className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] text-xs text-zinc-400 transition-all hover:border-white/15 hover:bg-white/5 hover:text-white cursor-pointer"
          title="GitHub 登录"
        >
          <Github className="size-3.5 text-zinc-500 hover:text-white transition-colors" />
          <span>GitHub</span>
        </button>
        <button
          type="button"
          onClick={handleDummySubmit}
          className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] text-xs text-zinc-400 transition-all hover:border-white/15 hover:bg-white/5 hover:text-white cursor-pointer"
          title="微信登录"
        >
          <MessageCircle className="size-3.5 text-zinc-500 hover:text-[#07C160] transition-colors" />
          <span>微信</span>
        </button>
      </div>
    </div>
  );
}
