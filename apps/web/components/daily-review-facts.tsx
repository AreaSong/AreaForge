import { BookOpenCheck, CheckCircle2, Clock3, FileCheck2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/page";
import { Metric } from "@/components/ui/metric";
import type { DailyReviewFactsDto } from "@/lib/contracts";

export function DailyReviewFacts({ facts }: { facts: DailyReviewFactsDto }) {
  const evidenceTotal = facts.evidence.length;
  return (
    <section aria-label="今日客观学习事实" className="space-y-4 border-y border-white/10 py-5">
      <SectionHeader
        title="今天真实发生了什么"
        description="以下内容来自今天已完成的学习记录，只用于复盘，不需要重新填写。"
        meta={<Badge tone={facts.lowConversionCount > 0 ? "warning" : "success"}>{facts.studyDayKey}</Badge>}
      />
      <dl className="af-metric-grid-four grid gap-px overflow-hidden rounded-[var(--af-radius-control)] border border-[var(--af-border)] bg-[var(--af-border)]">
        <Metric icon={Clock3} label="有效学习" value={`${facts.effectiveMinutes} 分钟`} detail={`${facts.effectiveSessionCount} 段有效专注`} layout="tile" valueSize="lg" />
        <Metric icon={CheckCircle2} label="今日任务" value={`${facts.completedTaskCount} / ${facts.plannedTaskCount}`} detail="已完成 / 已计划" layout="tile" valueSize="lg" />
        <Metric icon={FileCheck2} label="学习证据" value={`${evidenceTotal} 项`} detail={`卡片 ${facts.evidenceCounts.note} · 错题 ${facts.evidenceCounts.mistake} · 复测 ${facts.evidenceCounts.retest}`} layout="tile" valueSize="lg" />
        <Metric
          icon={facts.lowConversionCount > 0 ? TriangleAlert : BookOpenCheck}
          label="学习质量"
          value={facts.lowConversionCount > 0 ? `${facts.lowConversionCount} 段待补救` : "没有低转化"}
          detail={`已确认复习 ${facts.confirmedReviewCount} 次`}
          layout="tile"
          tone={facts.lowConversionCount > 0 ? "warning" : "neutral"}
          valueSize="lg"
        />
      </dl>

      {facts.subjects.length > 0 ? (
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-300">
          {facts.subjects.map((subject) => (
            <span key={subject.id} className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: subject.color }} aria-hidden="true" />
              {subject.name} {subject.effectiveMinutes} 分钟
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">今天还没有已完成的专注记录，仍可记录状态并安排明日最低行动。</p>
      )}

      {facts.evidence.length > 0 ? (
        <div>
          <h3 id="daily-facts-heading" className="text-sm font-medium text-zinc-200">今天留下的证据</h3>
          <ul className="af-content-grid-two mt-2 grid gap-2">
            {facts.evidence.map((receipt) => (
              <li key={`${receipt.evidenceType}:${receipt.evidenceId}`} className="min-w-0 border-l-2 border-teal-400/50 pl-3 text-sm">
                <span className="text-xs text-zinc-500">{evidenceLabel(receipt.evidenceType)}</span>
                <p className="break-words text-zinc-200">{receipt.label}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function evidenceLabel(type: "note" | "mistake" | "retest"): string {
  if (type === "note") return "知识卡片";
  if (type === "mistake") return "错题";
  return "复测";
}
