import { Cpu, Download, ExternalLink, HardDrive, Lock, ShieldCheck, Terminal } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/feedback";

export function SettingsRuntimeCard() {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0e1619]/90 p-3.5 sm:p-4 text-zinc-100 shadow-xl backdrop-blur-md space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="grid size-7 place-items-center rounded-lg bg-teal-500/10 text-teal-300 border border-teal-500/20">
            <Cpu size={15} />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-white">系统运行态与安全基线</h3>
            <span className="text-[10px] text-zinc-400">Release 镜像、更新代理与隔离边界</span>
          </div>
        </div>
        <Badge tone="success">v1.1.2 Release</Badge>
      </div>

      {/* 2-Column Runtime Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl border border-white/5 bg-[#090d0f] p-2.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-400">部署与镜像基线</span>
            <span className="font-mono text-[11px] text-teal-300">5df3841</span>
          </div>
          <p className="font-medium text-white text-xs">
            GitHub Release (GHCR 不可变 Digest)
          </p>
        </div>

        <div className="rounded-xl border border-white/5 bg-[#090d0f] p-2.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-400">自动更新策略</span>
            <span className="font-mono text-[11px] text-amber-300">none</span>
          </div>
          <p className="font-medium text-white text-xs">
            手动受控 apply，无静默自动更新
          </p>
        </div>

        <div className="rounded-xl border border-white/5 bg-[#090d0f] p-2.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-400">主状态持久化</span>
            <span className="font-mono text-[11px] text-teal-300">PostgreSQL</span>
          </div>
          <p className="font-medium text-white text-xs">
            只读 Web 容器，禁止 Web 端直接执行命令
          </p>
        </div>

        <div className="rounded-xl border border-white/5 bg-[#090d0f] p-2.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-400">AI 隐私沙箱</span>
            <span className="font-mono text-[11px] text-emerald-300">Zero Retention</span>
          </div>
          <p className="font-medium text-white text-xs">
            仅用户显式外呼，零持久化留存
          </p>
        </div>
      </div>

      {/* Quick Actions Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/5">
        <span className="text-[11px] text-zinc-500">工作空间快捷管理:</span>
        <div className="flex items-center gap-2">
          <Link
            href="/settings/data"
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-colors"
          >
            <Download size={12} />
            <span>导出学习树 JSON</span>
          </Link>
          <Link
            href="/settings/system"
            className="inline-flex items-center gap-1 rounded-lg border border-teal-500/30 bg-teal-500/10 px-2.5 py-1 text-xs font-medium text-teal-300 hover:bg-teal-500/20 transition-colors"
          >
            <ExternalLink size={12} />
            <span>版本中心与更新</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
