import {
  BookOpen,
  Boxes,
  BriefcaseBusiness,
  Clock,
  Database,
  FileCheck,
  FileText,
  HardDrive,
  HelpCircle,
  Layers,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/feedback";
import type { ExamWorkspaceDto, WorkspaceCapacityMetrics } from "@/lib/contracts";

export interface SettingsWorkspaceCapacityCardProps {
  workspace: {
    name: string;
    stableKey?: string;
    targetExamDate?: Date | string | null;
  } | null;
  metrics: WorkspaceCapacityMetrics;
}

export function SettingsWorkspaceCapacityCard({
  workspace,
  metrics,
}: SettingsWorkspaceCapacityCardProps) {
  const targetDateStr = workspace?.targetExamDate
    ? typeof workspace.targetExamDate === "string"
      ? workspace.targetExamDate.slice(0, 10)
      : new Date(workspace.targetExamDate).toISOString().slice(0, 10)
    : null;

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0e1619]/90 p-3.5 sm:p-4 text-zinc-100 shadow-xl backdrop-blur-md space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="grid size-7 place-items-center rounded-lg bg-teal-500/10 text-teal-300 border border-teal-500/20">
            <HardDrive size={15} />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-white">工作空间容量与存储</h3>
            <span className="text-[10px] text-zinc-400">对象实体与隔离附件元信息</span>
          </div>
        </div>
        <Badge tone={workspace ? "success" : "warning"}>
          {workspace ? "正常运行" : "待初始化"}
        </Badge>
      </div>

      {/* Workspace Context Capsule */}
      {workspace ? (
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-2.5 text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-medium text-white truncate">{workspace.name}</span>
            <span className="font-mono text-[11px] text-zinc-500">{workspace.stableKey}</span>
          </div>
          {targetDateStr && (
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Clock size={12} className="text-teal-400 shrink-0" />
              <span>目标考日: <strong className="text-zinc-200">{targetDateStr}</strong></span>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-2.5 text-xs text-amber-300">
          尚未选定活跃考试工作区，请在“考试与科目”中设定。
        </div>
      )}

      {/* 2-Column High-Density Metrics Grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl border border-white/5 bg-[#090d0f] p-2 space-y-0.5">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <BriefcaseBusiness size={12} className="text-teal-400" />
            <span>使用中科目</span>
          </div>
          <p className="text-sm font-semibold font-mono text-white">{metrics.activeSubjectCount} 科</p>
        </div>

        <div className="rounded-xl border border-white/5 bg-[#090d0f] p-2 space-y-0.5">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <Layers size={12} className="text-teal-400" />
            <span>考纲节点</span>
          </div>
          <p className="text-sm font-semibold font-mono text-white">{metrics.syllabusNodeCount} 个</p>
        </div>

        <div className="rounded-xl border border-white/5 bg-[#090d0f] p-2 space-y-0.5">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <BookOpen size={12} className="text-teal-400" />
            <span>知识点 / 卡片</span>
          </div>
          <p className="text-sm font-semibold font-mono text-white">
            {metrics.knowledgePointCount} 点 · {metrics.noteCount} 篇
          </p>
        </div>

        <div className="rounded-xl border border-white/5 bg-[#090d0f] p-2 space-y-0.5">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <HelpCircle size={12} className="text-teal-400" />
            <span>错题记录</span>
          </div>
          <p className="text-sm font-semibold font-mono text-white">{metrics.mistakeCount} 条</p>
        </div>

        <div className="rounded-xl border border-white/5 bg-[#090d0f] p-2 space-y-0.5">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <Clock size={12} className="text-teal-400" />
            <span>专注会话</span>
          </div>
          <p className="text-sm font-semibold font-mono text-white">
            {metrics.sessionCount} 次 ({metrics.totalSessionHoursFormatted})
          </p>
        </div>

        <div className="rounded-xl border border-white/5 bg-[#090d0f] p-2 space-y-0.5">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <FileText size={12} className="text-teal-400" />
            <span>笔记与附件</span>
          </div>
          <p className="text-sm font-semibold font-mono text-teal-300 truncate">
            {metrics.attachmentCount} 份 ({metrics.totalAttachmentBytesFormatted})
          </p>
        </div>
      </div>

      {/* Storage & Privacy Note */}
      <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-2 text-[11px] text-zinc-400">
        <ShieldCheck size={14} className="text-teal-400 shrink-0" />
        <span className="truncate">文件存储遵循 OPS-007 写入意图与鉴权隔离协议</span>
      </div>
    </div>
  );
}
