import { Cpu, Download, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/feedback";
import type { UpdateCenterStatus } from "@/lib/system/update-center";

export function SettingsRuntimeCard(props: {
  status: Pick<UpdateCenterStatus, "currentVersion" | "deployMode" | "autoApply" | "signatureRequired">;
}) {
  const { status } = props;
  const versionLabel = status.currentVersion.startsWith("v") ? status.currentVersion : `v${status.currentVersion}`;
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
        <Badge tone={status.deployMode === "release" ? "success" : "warning"}>{versionLabel}</Badge>
      </div>

      {/* 2-Column Runtime Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl border border-white/5 bg-[#090d0f] p-2.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-400">部署与镜像基线</span>
            <span className="font-mono text-[11px] text-teal-300">{deployModeLabel(status.deployMode)}</span>
          </div>
          <p className="font-medium text-white text-xs">
            {status.deployMode === "release" ? "GitHub Release（GHCR 不可变 digest）" : "当前实例未声明 Release 镜像身份"}
          </p>
        </div>

        <div className="rounded-xl border border-white/5 bg-[#090d0f] p-2.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-400">自动更新策略</span>
            <span className="font-mono text-[11px] text-amber-300">{status.autoApply}</span>
          </div>
          <p className="font-medium text-white text-xs">
            {autoApplyDescription(status.autoApply)}
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
            <span className="text-[11px] text-zinc-400">更新制品信任</span>
            <span className="font-mono text-[11px] text-emerald-300">{signaturePolicyLabel(status.signatureRequired)}</span>
          </div>
          <p className="font-medium text-white text-xs">
            Release 更新由服务器侧校验，不由 Web runtime 执行
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

function deployModeLabel(mode: UpdateCenterStatus["deployMode"]): string {
  if (mode === "release") return "release";
  if (mode === "local_build") return "local build";
  return "unknown";
}

function autoApplyDescription(policy: UpdateCenterStatus["autoApply"]): string {
  if (policy === "none") return "手动受控 apply，无静默自动更新";
  if (policy === "patch") return "只允许服务器侧自动应用补丁版本";
  return `当前兼容策略为 ${policy}，写入仍受版本中心门禁约束`;
}

function signaturePolicyLabel(required: boolean): string {
  return required ? "签名必需" : "当前未要求";
}
