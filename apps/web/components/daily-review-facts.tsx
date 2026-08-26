import { BookOpenCheck, CheckCircle2, Clock3, FileCheck2, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { Metric } from "@/components/ui/metric";
import { SectionHeader } from "@/components/ui/page";
import type { DailyReviewFactsDto } from "@/lib/contracts";

export function DailyReviewFacts({ facts }: { facts: DailyReviewFactsDto }) {
  const evidenceTotal = facts.evidence.length;
  return (
    <Card variant="master" className="p-6 space-y-5" aria-label="今日客观学习事实">
      <SectionHeader
        title="今天真实发生了什么"
        description="以下内容来自今天已完成的学习记录，只用于复盘，不需要重新填写。"
        meta={<Badge tone={facts.lowConversionCount > 0 ? "warning" : "success"}>{facts.studyDayKey}</Badge>}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card variant="subtle" className="p-4">
          <Metric icon={Clock3} label="有效学习" value={`${facts.effectiveMinutes} 分钟`} detail={`${facts.effectiveSessionCount} 段有效专注`} layout="tile" valueSize="lg" />
        </Card>
        <Card variant="subtle" className="p-4">
          <Metric icon={CheckCircle2} label="今日任务" value={`${facts.completedTaskCount} / ${facts.plannedTaskCount}`} detail="已完成 / 已计划" layout="tile" valueSize="lg" />
        </Card>
        <Card variant="subtle" className="p-4">
          <Metric icon={FileCheck2} label="学习证据" value={`${evidenceTotal} 项`} detail={`卡片 ${facts.evidenceCounts.note} · 错题 ${facts.evidenceCounts.mistake} · 复测 ${facts.evidenceCounts.retest}`} layout="tile" valueSize="lg" />
        </Card>
        <Card variant="subtle" className="p-4">
          <Metric
            icon={facts.lowConversionCount > 0 ? TriangleAlert : BookOpenCheck}
            label="学习质量"
            value={facts.lowConversionCount > 0 ? `${facts.lowConversionCount} 段待补救` : "没有低转化"}
            detail={`已确认复习 ${facts.confirmedReviewCount} 次`}
            layout="tile"
            tone={facts.lowConversionCount > 0 ? "warning" : "neutral"}
            valueSize="lg"
          />
        </Card>
      </div>

      {facts.subjects.length > 0 ? (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5 text-xs text-zinc-300">
          {facts.subjects.map((subject) => (
            <span key={subject.id} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: subject.color }} aria-hidden="true" />
              <span className="font-medium text-white">{subject.name}</span>
              <span className="text-zinc-400">{subject.effectiveMinutes} 分钟</span>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-500 pt-2 border-t border-white/5">今天还没有已完成的专注记录，仍可记录状态并安排明日最低行动。</p>
      )}

      {facts.evidence.length > 0 ? (
        <div className="pt-2 border-t border-white/5 space-y-3">
          <h3 id="daily-facts-heading" className="text-xs font-semibold text-zinc-300">今天留下的证据</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {facts.evidence.map((receipt) => (
              <Card key={`${receipt.evidenceType}:${receipt.evidenceId}`} variant="subtle" className="p-3 border-l-2 border-l-teal-400/80">
                <span className="text-[11px] font-medium text-teal-300">{evidenceLabel(receipt.evidenceType)}</span>
                <p className="mt-0.5 text-xs text-zinc-200 break-words">{receipt.label}</p>
              </Card>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function evidenceLabel(type: "note" | "mistake" | "retest"): string {
  if (type === "note") return "知识卡片";
  if (type === "mistake") return "错题";
  return "复测";
}
