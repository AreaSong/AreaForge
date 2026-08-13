"use client";

import { Loader2, LockKeyhole, Mail, Key, Github, MessageCircle, Wand2, Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function LoginForm({ returnTo = "/today" }: { returnTo?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const email = form.get("email") as string;
    
    // 前置简易格式校验
    if (!email.includes('@')) {
      setError("请输入有效的邮箱格式。");
      setPending(false);
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
          password: form.get("password"),
        }),
      });
    } catch {
      setPending(false);
      setError("服务暂时不可用，请检查网络后重试。");
      return;
    }

    setPending(false);

    if (!response.ok) {
      if (response.status === 401) setError("邮箱或密码不正确。");
      else if (response.status === 429) setError("失败次数过多，稍后再试。");
      else if (response.status >= 500) setError("系统核心离线，请稍后重试。");
      else setError("连接未建立，请检查凭证。");
      return;
    }

    router.replace(returnTo);
    router.refresh();
  }

  function handleDummySubmit(event: React.MouseEvent) {
    if ('preventDefault' in event) event.preventDefault();
    setError("当前版本受限，更多通道将于 v1.2 开放。");
  }

  return (
    <div className="w-full max-w-[380px] mx-auto animate-fade-in-up">
      <div className="mb-10 text-center relative">
        <div className="mb-4 inline-flex items-center justify-center gap-2 font-mono text-[10px] font-bold tracking-[0.4em] text-teal-400 uppercase">
          <span className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-pulse shadow-[0_0_10px_currentColor]"></span>
          AUTH.PROTOCOL_V1
        </div>
        <h1 className="text-3xl font-black tracking-tighter text-white drop-shadow-md">通行证认证</h1>
        <p className="mt-3 text-sm text-zinc-400 font-mono tracking-wide">验证身份以唤醒系统引擎</p>
      </div>

      {/* Primary Login: Email & Password */}
      <form className="animate-fade-in" onSubmit={submitAccount}>
        <div className="space-y-5">
          <div>
            <label className="sr-only" htmlFor="email">邮箱</label>
            <div className="group relative">
              <Mail className="absolute left-4 top-[14px] h-[18px] w-[18px] text-zinc-500 transition-colors group-focus-within:text-teal-400" />
              <input
                autoComplete="email"
                className="h-12 w-full rounded-xl border border-white/10 bg-[#0A0D10]/80 backdrop-blur-md pl-12 pr-4 text-sm text-white outline-none transition-all placeholder:text-zinc-600 hover:border-white/20 focus:border-teal-400 focus:bg-white/5 focus:shadow-[0_4px_20px_-4px_rgba(45,212,191,0.3)] focus:-translate-y-[1px]"
                id="email"
                name="email"
                placeholder="极客通行邮箱"
                required
                type="email"
                disabled={pending}
              />
            </div>
          </div>

          <div>
            <label className="sr-only" htmlFor="password">密码</label>
            <div className="group relative">
              <LockKeyhole className="absolute left-4 top-[14px] h-[18px] w-[18px] text-zinc-500 transition-colors group-focus-within:text-teal-400" />
              <input
                autoComplete="current-password"
                className="h-12 w-full rounded-xl border border-white/10 bg-[#0A0D10]/80 backdrop-blur-md pl-12 pr-12 text-sm text-white outline-none transition-all placeholder:text-zinc-600 hover:border-white/20 focus:border-teal-400 focus:bg-white/5 focus:shadow-[0_4px_20px_-4px_rgba(45,212,191,0.3)] focus:-translate-y-[1px]"
                id="password"
                name="password"
                placeholder="系统密钥"
                required
                type={showPassword ? "text" : "password"}
                disabled={pending}
              />
              <button 
                type="button" 
                onClick={() => setShowPassword(!showPassword)} 
                className="absolute right-2 top-[6px] p-2 text-zinc-500 hover:text-zinc-300 transition-colors rounded-lg hover:bg-white/5 outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                disabled={pending}
              >
                {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
              </button>
            </div>
          </div>
        </div>

        {/* Error Message Space (Fixed height to prevent layout shift) */}
        <div className="mt-5 min-h-[44px] flex items-center justify-center">
          {error ? (
            <p aria-atomic="true" aria-live="assertive" className="flex w-full items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-400 font-mono animate-fade-in" role="alert">
              [ERR] {error}
            </p>
          ) : null}
        </div>

        <button
          className="group relative mt-2 flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-teal-500/10 font-bold tracking-[0.2em] text-teal-400 border border-teal-500/30 transition-all hover:bg-teal-500 hover:text-[#05080A] hover:border-teal-400 hover:shadow-[0_0_30px_rgba(45,212,191,0.5)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05080A] disabled:cursor-not-allowed disabled:opacity-50 overflow-hidden"
          disabled={pending}
          type="submit"
        >
          {pending ? <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" /> : null}
          <div className="absolute inset-0 -translate-x-[150%] bg-gradient-to-r from-transparent via-white/20 to-transparent group-hover:translate-x-[150%] transition-transform duration-1000 ease-in-out"></div>
          <span className="relative z-10 flex items-center gap-2">{pending ? "正在建立神经连接..." : "初始化引擎"}</span>
        </button>
      </form>

      {/* Divider */}
      <div className="my-8 flex items-center gap-4 opacity-50">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/20 to-white/20"></div>
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-500">外部链接口</span>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent via-white/20 to-white/20"></div>
      </div>

      {/* Advanced / Quick Login Methods */}
      <div className="space-y-3">
        <button 
          onClick={handleDummySubmit}
          className="group relative flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] text-sm font-medium text-zinc-400 transition-all hover:border-cyan-500/30 hover:bg-cyan-500/10 hover:text-cyan-400"
        >
          <Wand2 className="h-4 w-4 text-zinc-500 group-hover:text-cyan-400 transition-colors" />
          发送魔法链接 (免密)
        </button>
        
        <button 
          onClick={handleDummySubmit}
          className="group relative flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] text-sm font-medium text-zinc-400 transition-all hover:border-amber-500/30 hover:bg-amber-500/10 hover:text-amber-400"
        >
          <Key className="h-4 w-4 text-zinc-500 group-hover:text-amber-400 transition-colors" />
          Vault Key 临时访问
        </button>
      </div>

      {/* SSO / Social Logins */}
      <div className="mt-3 flex justify-center gap-3">
        <button type="button" onClick={handleDummySubmit} className="group flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] text-sm text-zinc-400 transition-all hover:border-white/10 hover:bg-white/5 hover:text-white" title="GitHub">
          <Github className="h-4 w-4 text-zinc-500 group-hover:text-white transition-colors" />
          <span className="hidden sm:inline">GitHub</span>
        </button>
        <button type="button" onClick={handleDummySubmit} className="group flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] text-sm text-zinc-400 transition-all hover:border-white/10 hover:bg-white/5 hover:text-white" title="微信">
          <MessageCircle className="h-4 w-4 text-zinc-500 group-hover:text-[#07C160] transition-colors" />
          <span className="hidden sm:inline">WeChat</span>
        </button>
      </div>
    </div>
  );
}
