"use client";

import { Loader2, LockKeyhole, Mail, Key, Github, MessageCircle, Wand2, Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function LoginForm({ returnTo = "/focus" }: { returnTo?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    let response: Response;
    try {
      response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: form.get("email"),
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
      else if (response.status >= 500) setError("服务暂时不可用，请稍后重试。");
      else setError("登录请求未完成，请检查输入后重试。");
      return;
    }

    router.replace(returnTo);
    router.refresh();
  }

  function handleDummySubmit(event: React.MouseEvent) {
    if ('preventDefault' in event) event.preventDefault();
    setError("敬请期待 (Coming in v1.2)");
  }

  return (
    <div className="w-full max-w-sm animate-fade-in-up">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-white">通行证认证</h1>
        <p className="mt-2 text-sm text-zinc-500">验证身份以进入行动中心</p>
      </div>

      {/* Primary Login: Email & Password */}
      <form className="animate-fade-in" onSubmit={submitAccount}>
        <div className="space-y-4">
          <div>
            <label className="sr-only" htmlFor="email">邮箱</label>
            <div className="group relative">
              <Mail className="absolute left-4 top-3.5 h-4 w-4 text-zinc-500 transition-colors group-focus-within:text-teal-400" />
              <input
                autoComplete="email"
                className="h-11 w-full rounded-lg border border-white/10 bg-white/5 pl-11 pr-4 text-sm text-white outline-none transition-all placeholder:text-zinc-600 focus:border-teal-400 focus:bg-white/10 focus:shadow-[0_0_0_2px_rgba(45,212,191,0.1)]"
                id="email"
                name="email"
                placeholder="邮箱地址"
                required
                type="email"
              />
            </div>
          </div>

          <div>
            <label className="sr-only" htmlFor="password">密码</label>
            <div className="group relative">
              <LockKeyhole className="absolute left-4 top-3.5 h-4 w-4 text-zinc-500 transition-colors group-focus-within:text-teal-400" />
              <input
                autoComplete="current-password"
                className="h-11 w-full rounded-lg border border-white/10 bg-white/5 pl-11 pr-12 text-sm text-white outline-none transition-all placeholder:text-zinc-600 focus:border-teal-400 focus:bg-white/10 focus:shadow-[0_0_0_2px_rgba(45,212,191,0.1)]"
                id="password"
                name="password"
                placeholder="密码"
                required
                type={showPassword ? "text" : "password"}
              />
              <button 
                type="button" 
                onClick={() => setShowPassword(!showPassword)} 
                className="absolute right-3 top-2 p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors rounded-md hover:bg-white/5 outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* Error Message Space (Fixed height to prevent layout shift) */}
        <div className="mt-4 min-h-[40px] flex items-center justify-center">
          {error ? (
            <p aria-atomic="true" aria-live="assertive" className="flex w-full items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400 animate-fade-in" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <button
          className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-teal-400 font-medium text-[#071011] transition-all hover:bg-teal-300 hover:shadow-[0_0_20px_rgba(45,212,191,0.4)] focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#080b0f] disabled:cursor-not-allowed disabled:opacity-70"
          disabled={pending}
          type="submit"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "正在进入..." : "密码登录"}
        </button>
      </form>

      {/* Divider */}
      <div className="my-8 flex items-center gap-4 opacity-60">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-white/10"></div>
        <span className="text-xs uppercase tracking-widest text-zinc-500">或</span>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent via-white/10 to-white/10"></div>
      </div>

      {/* Advanced / Quick Login Methods */}
      <div className="space-y-3">
        <button 
          onClick={handleDummySubmit}
          className="group relative flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] text-sm font-medium text-zinc-300 transition-all hover:border-cyan-500/30 hover:bg-cyan-500/10 hover:text-cyan-300"
        >
          <Wand2 className="h-4 w-4 text-zinc-500 group-hover:text-cyan-400" />
          发送魔法链接 (免密)
        </button>
        
        <button 
          onClick={handleDummySubmit}
          className="group relative flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] text-sm font-medium text-zinc-300 transition-all hover:border-amber-500/30 hover:bg-amber-500/10 hover:text-amber-300"
        >
          <Key className="h-4 w-4 text-zinc-500 group-hover:text-amber-400" />
          Vault Key 临时访问
        </button>
      </div>

      {/* SSO / Social Logins */}
      <div className="mt-4 flex justify-center gap-3">
        <button type="button" onClick={handleDummySubmit} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] text-sm text-zinc-400 transition-all hover:border-white/10 hover:bg-white/5 hover:text-white" title="GitHub">
          <Github className="h-4 w-4" />
          <span className="hidden sm:inline">GitHub</span>
        </button>
        <button type="button" onClick={handleDummySubmit} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] text-sm text-zinc-400 transition-all hover:border-white/10 hover:bg-white/5 hover:text-white" title="微信">
          <MessageCircle className="h-4 w-4" />
          <span className="hidden sm:inline">WeChat</span>
        </button>
      </div>
    </div>
  );
}
