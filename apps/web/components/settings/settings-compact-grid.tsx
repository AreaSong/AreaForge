import {
  BellRing,
  Bot,
  BriefcaseBusiness,
  ChevronRight,
  Database,
  MonitorCog,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/feedback";
import type { ExamWorkspaceDto } from "@/lib/contracts";

export interface SettingsCompactGridProps {
  activeWorkspace: {
    name: string;
    stableKey?: string;
    targetExamDate?: Date | string | null;
  } | null;
  activeSubjectCount: number;
  aiConfigured?: boolean;
}

export function SettingsCompactGrid({
  activeWorkspace,
  activeSubjectCount,
  aiConfigured = false,
}: SettingsCompactGridProps) {
  const sections = [
    {
      href: "/settings/exams",
      title: "考试与科目",
      subtitle: activeWorkspace ? `${activeWorkspace.name} · ${activeSubjectCount} 科目` : "待建立工作区",
      description: "配置考研目标年份、目标考日、科目名称与自定义色系",
      Icon: BriefcaseBusiness,
      attention: !activeWorkspace,
      badge: activeWorkspace ? `${activeSubjectCount} 科目活跃` : "需先配置",
      tone: activeWorkspace ? ("info" as const) : ("warning" as const),
    },
    {
      href: "/settings/profile",
      title: "个人与恢复",
      subtitle: "动机封存与精力防线",
      description: "动机保险箱管理、低能量恢复提醒与心态应急方案",
      Icon: UserRound,
      badge: "隐私保护",
      tone: "neutral" as const,
    },
    {
      href: "/settings/learning",
      title: "学习与提醒",
      subtitle: "通知偏好与作息窗",
      description: "浏览器通知授权、静音时段、深色主题与高密度显示偏好",
      Icon: BellRing,
      badge: "本地偏好",
      tone: "neutral" as const,
    },
    {
      href: "/settings/ai",
      title: "AI 与隐私",
      subtitle: aiConfigured ? "Provider 已就绪" : "受控外呼",
      description: "OpenAI 兼容 API Key 配置、数据最小化过滤与提示词边界",
      Icon: Bot,
      badge: aiConfigured ? "已授权" : "受控外呼",
      tone: aiConfigured ? ("success" as const) : ("info" as const),
    },
    {
      href: "/settings/data",
      title: "数据与安全",
      subtitle: "学习树导入导出",
      description: "全站学习树 JSON 备份导出、批量导入与数据库只读边界",
      Icon: Database,
      badge: "主状态源",
      tone: "info" as const,
    },
    {
      href: "/settings/system",
      title: "系统与更新",
      subtitle: "v1.1.2 (Release)",
      description: "版本发布基线、root update-agent 受控更新与回滚历史",
      Icon: MonitorCog,
      badge: "v1.1.2",
      tone: "success" as const,
    },
  ] as const;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {sections.map(({ href, title, subtitle, description, Icon, badge, tone, ...item }) => (
        <Link
          key={href}
          href={href}
          className="group block min-w-0 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 rounded-2xl"
        >
          <div className="h-full rounded-2xl border border-white/10 bg-[#0e1619]/90 p-3.5 transition-all duration-200 hover:border-teal-400/40 hover:bg-[#121c20] hover:shadow-[0_0_15px_rgba(45,212,191,0.12)] flex flex-col justify-between space-y-2.5">
            <div className="flex items-start justify-between gap-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-teal-300 transition-colors group-hover:border-teal-400/30 group-hover:bg-teal-500/10 group-hover:text-teal-200">
                  <Icon size={16} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <strong className="text-xs font-semibold text-white group-hover:text-teal-200 transition-colors truncate block">
                    {title}
                  </strong>
                  <span className="text-[10px] text-zinc-500 truncate block">{subtitle}</span>
                </div>
              </div>

              <div className="shrink-0 flex items-center gap-1">
                {"attention" in item && item.attention ? (
                  <Badge tone="warning">需配置</Badge>
                ) : (
                  <Badge tone={tone}>{badge}</Badge>
                )}
                <ChevronRight
                  size={15}
                  className="text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-300"
                  aria-hidden="true"
                />
              </div>
            </div>

            <p className="text-[11px] leading-relaxed text-zinc-400 line-clamp-2">
              {description}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}
