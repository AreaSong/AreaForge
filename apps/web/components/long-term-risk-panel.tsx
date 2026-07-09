import { AlertTriangle, ArrowRight, ClipboardList, ShieldCheck } from "lucide-react";
import type { LongTermRiskSummaryDto } from "@/lib/study/long-term-risk-service";

interface LongTermRiskPanelProps {
  summary: LongTermRiskSummaryDto;
  title?: string;
  description?: string;
  maxItems?: number;
}

export function LongTermRiskPanel({
  summary,
  title = "长期风险",
  description = "同一组来源、窗口、证据新鲜度和下一步动作。",
  maxItems = 4,
}: LongTermRiskPanelProps) {
  const risks = summary.risks.slice(0, maxItems);

  return (
    <section className="rounded-lg border border-white/10 bg-[#101419] p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-300" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-white">{title}</h2>
          </div>
          <p className="mt-2 text-sm leading-6 text-zinc-400">{description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`rounded-md border px-2 py-1 text-xs ${levelClass(summary.topRiskLevel)}`}>
            {labelSeverity(summary.topRiskLevel)}
          </span>
          <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300">
            {summary.canAutoApply ? "可自动应用" : "只读风险"}
          </span>
          <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300">
            {summary.requiresUserConfirmation ? "需确认" : "无需确认"}
          </span>
        </div>
      </div>

      {summary.focusSubjects.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {summary.focusSubjects.map((subject) => (
            <span key={subject} className="rounded-md border border-teal-300/20 bg-teal-300/10 px-3 py-2 text-sm text-teal-50">
              {subject}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-5 grid gap-3">
        {risks.length === 0 ? (
          <p className="rounded-md border border-dashed border-white/10 px-4 py-6 text-sm leading-6 text-zinc-400">
            暂无明确长期风险，继续保持任务、笔记、错题、复盘和阶段计划的证据链。
          </p>
        ) : null}
        {risks.map((risk) => (
          <article key={risk.id} className={`rounded-md border p-4 ${riskClass(risk.severity)}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-white">{risk.title}</h3>
                  <span className="rounded-md border border-white/10 px-2 py-1 text-xs opacity-80">
                    {labelSource(risk.source)}
                  </span>
                  <span className="rounded-md border border-white/10 px-2 py-1 text-xs opacity-80">
                    证据新鲜度：{labelFreshness(risk.evidenceFreshness)}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6">{risk.detail}</p>
                {risk.syllabusNodeTitle ? (
                  <p className="mt-2 text-xs opacity-75">节点：{risk.syllabusNodeTitle}</p>
                ) : null}
              </div>
              <span className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-xs opacity-80">
                {labelSeverity(risk.severity)}
              </span>
            </div>
            <div className="mt-3 flex items-start gap-2 text-sm text-white">
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>{risk.nextAction}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-5 grid gap-2 rounded-md border border-white/10 bg-black/20 p-4">
        <div className="flex items-center gap-2 text-sm text-zinc-200">
          <ClipboardList className="h-4 w-4 text-teal-300" aria-hidden="true" />
          <span>下一步动作</span>
        </div>
        {summary.nextActions.slice(0, 3).map((action) => (
          <p key={action} className="text-sm leading-6 text-zinc-400">
            {action}
          </p>
        ))}
        <div className="flex items-center gap-2 pt-1 text-xs text-zinc-500">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          <span>所有长期建议保持确认边界，不自动修改任务或阶段计划。</span>
        </div>
      </div>
    </section>
  );
}

function riskClass(severity: string): string {
  switch (severity) {
    case "critical":
      return "border-red-300/25 bg-red-300/10 text-red-50";
    case "danger":
      return "border-rose-300/25 bg-rose-300/10 text-rose-50";
    case "warning":
      return "border-amber-300/25 bg-amber-300/10 text-amber-50";
    default:
      return "border-sky-300/20 bg-sky-300/10 text-sky-50";
  }
}

function levelClass(severity: string): string {
  switch (severity) {
    case "critical":
      return "border-red-300/30 text-red-100";
    case "danger":
      return "border-rose-300/30 text-rose-100";
    case "warning":
      return "border-amber-300/30 text-amber-100";
    default:
      return "border-sky-300/30 text-sky-100";
  }
}

function labelSeverity(severity: string): string {
  switch (severity) {
    case "critical":
      return "极高风险";
    case "danger":
      return "高风险";
    case "warning":
      return "需注意";
    default:
      return "稳态";
  }
}

function labelFreshness(freshness: string): string {
  switch (freshness) {
    case "fresh":
      return "新";
    case "stale":
      return "偏旧";
    default:
      return "未知";
  }
}

function labelSource(source: string): string {
  switch (source) {
    case "periodic_report":
      return "报告";
    case "task_debt":
      return "任务债务";
    case "syllabus_map":
      return "作战地图";
    case "review_queue":
      return "复习队列";
    case "simulation":
      return "模拟";
    case "stage_plan":
      return "阶段计划";
    case "theme_state":
      return "状态主题";
    default:
      return "长期信号";
  }
}
