import { ArrowRight, BarChart3, CalendarDays, CircleCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { PageFrame, PageHeader, SectionHeader, Toolbar } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { formatDateMonthDay, formatDateRange } from "@/lib/formatters";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { getAnalyticsSummary, type AnalyticsRiskItemDto } from "@/lib/study/analytics-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap/stages/trend");

export default async function StageAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const windowDays = query.window === "30" ? 30 : 7;
  const analytics = await getAnalyticsSummary(new Date(), user.id, windowDays);
  const primaryRisk = analytics.risks[0];

  return (
    <PageFrame variant="dashboard-wide">
      <PageHeader
        eyebrow="阶段"
        title="学习趋势"
        description={`${formatDateRange(analytics.range.start, analytics.range.end)} · 用趋势解释风险，不把统计当作自动决策。`}
        status={<Badge tone={primaryRisk ? severityTone(primaryRisk.severity) : "success"}>{primaryRisk ? "存在待处理风险" : "暂无升级风险"}</Badge>}
      />

      <Toolbar label="趋势周期">
        <WindowLink days={7} active={windowDays === 7} />
        <WindowLink days={30} active={windowDays === 30} />
      </Toolbar>

      <Card variant="accent" className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 p-6">
        <div className="min-w-0">
          <p className={`flex items-center gap-2 text-xs font-medium ${primaryRisk ? riskTone(primaryRisk.severity) : "text-emerald-200"}`}>
            {primaryRisk ? <TriangleAlert size={15} aria-hidden="true" /> : <CircleCheck size={15} aria-hidden="true" />}
            {primaryRisk ? "当前最高风险" : "当前判断"}
          </p>
          <h2 className="mt-2 text-2xl font-semibold leading-9 text-white">{primaryRisk?.title ?? "当前周期没有需要升级处理的风险"}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{primaryRisk?.detail ?? "继续按当前节奏执行，并在周期复盘中确认下一阶段是否需要调整。"}</p>
          <p className="mt-3 text-sm text-zinc-500">建议：{primaryRisk?.action ?? analytics.actions[0] ?? "保持当前行动节奏。"}</p>
        </div>
        <ButtonLink href={primaryRisk ? riskHref(primaryRisk) : "/roadmap/reviews"} variant="primary" size="lg" className="shrink-0">
          {primaryRisk ? riskActionLabel(primaryRisk) : "查看周期复盘"}<ArrowRight size={16} aria-hidden="true" />
        </ButtonLink>
      </Card>

      <section className="space-y-4">
        <SectionHeader title={`${windowDays} 天执行事实`} description="这些指标用于解释趋势，不会自动创建任务或修改阶段。" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card variant="subtle" className="p-4">
            <p className="text-xs text-zinc-400">有效投入</p>
            <p className="mt-2 text-xl font-semibold text-white">{analytics.totals.weekEffectiveMinutes} 分</p>
          </Card>
          <Card variant="subtle" className="p-4">
            <p className="text-xs text-zinc-400">任务完成率</p>
            <p className="mt-2 text-xl font-semibold text-white">{Math.round(analytics.totals.weeklyTaskCompletionRate * 100)}%</p>
          </Card>
          <Card variant="subtle" className="p-4">
            <p className="text-xs text-zinc-400">连续学习</p>
            <p className="mt-2 text-xl font-semibold text-white">{analytics.totals.streakDays} 天</p>
          </Card>
          <Card variant="subtle" className="p-4">
            <p className="text-xs text-zinc-400">低转化活动</p>
            <p className="mt-2 text-xl font-semibold text-white">{analytics.totals.lowConversionCount} 次</p>
          </Card>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="daily-trend-title">
        <SectionHeader title="每日投入" description="灰色为总计，绿色为有效学习。" meta={<span className="flex items-center gap-2 text-xs text-zinc-500"><BarChart3 size={14} aria-hidden="true" />分钟</span>} />
        <Card variant="master" className="p-6">
          <div className="overflow-x-auto pb-2" tabIndex={0} aria-label="每日投入趋势，可横向滚动">
            <div id="daily-trend-title" className="flex min-w-max items-end gap-3 justify-between sm:justify-start">
              {analytics.daily.map((point) => {
                const maxMinutes = Math.max(60, ...analytics.daily.map((item) => item.totalMinutes));
                const totalHeight = Math.max(4, Math.round((point.totalMinutes / maxMinutes) * 112));
                const effectiveHeight = Math.max(0, Math.round((point.effectiveMinutes / maxMinutes) * 112));
                return (
                  <div key={point.dayKey} className="w-10 text-center flex flex-col items-center">
                    <div className="relative h-28 w-6 rounded-md bg-white/5 border border-white/5 flex items-end justify-center overflow-hidden" aria-label={`${formatDateMonthDay(point.dayKey)}：总计 ${point.totalMinutes} 分钟，有效 ${point.effectiveMinutes} 分钟`} role="img">
                      <span className="absolute inset-x-0 bottom-0 rounded-sm bg-zinc-600/80 transition-all duration-300" style={{ height: totalHeight }} />
                      <span className="absolute inset-x-0 bottom-0 rounded-sm bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.6)] transition-all duration-300" style={{ height: effectiveHeight }} />
                    </div>
                    <span className="mt-2 block text-[11px] font-medium text-zinc-400">{formatDateMonthDay(point.dayKey)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start">
        <Card variant="master" className="p-6 space-y-4">
          <SectionHeader title="科目投入" description="占比只表示时间分配，不代表掌握程度。" />
          {analytics.subjects.length > 0 ? (
            <div className="space-y-4">
              {analytics.subjects.map((subject) => (
                <div key={subject.subjectId} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-zinc-200">{subject.subjectName}</span>
                    <span className="text-xs text-zinc-400">{subject.effectiveMinutes} 分 · {subject.share}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/5" aria-hidden="true">
                    <div className="h-full rounded-full transition-all duration-300" style={{ width: `${subject.share}%`, backgroundColor: subject.subjectColor }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-4 text-sm text-zinc-500">当前周期没有科目投入。</p>
          )}
        </Card>

        <Card variant="subtle" className="p-6 space-y-4">
          <SectionHeader title="其他风险" description={primaryRisk ? "其余风险按严重度继续排队处理。" : "当前没有需要升级处理的长期风险。"} />
          {analytics.risks.length > 1 ? (
            <ul className="divide-y divide-white/5">
              {analytics.risks.slice(1).map((risk) => (
                <li key={`${risk.type}-${risk.id}`} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-col gap-1.5">
                    <p className={riskTone(risk.severity)}>{risk.title}</p>
                    <p className="text-xs leading-5 text-zinc-400">{risk.detail}</p>
                    <Link className="self-start text-xs font-medium text-teal-300 hover:underline mt-1" href={riskHref(risk)}>
                      {riskActionLabel(risk)} →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">没有其他风险需要排队处理。</p>
          )}
        </Card>
      </div>
    </PageFrame>
  );
}

function WindowLink({ days, active }: { days: 7 | 30; active: boolean }) {
  return (
    <Link
      href={`/roadmap/stages/trend?window=${days}`}
      aria-current={active ? "page" : undefined}
      className={`inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-xs font-medium transition-all ${
        active
          ? "border border-teal-500/30 bg-teal-400/10 text-teal-200 shadow-[0_0_12px_rgba(45,212,191,0.15)]"
          : "border border-white/5 bg-white/[0.02] text-zinc-400 hover:border-white/10 hover:text-white"
      }`}
    >
      <CalendarDays size={13} aria-hidden="true" />
      {days} 天
    </Link>
  );
}

function riskHref(risk: AnalyticsRiskItemDto) { if (risk.type === "weak_node" && risk.syllabusNodeId) return `/knowledge/syllabi/${risk.syllabusNodeId}`; if (risk.type === "note_review" || risk.type === "mistake_review") return "/knowledge/reviews"; if (risk.type === "review_gap") return "/roadmap/reviews/daily"; if (risk.type === "low_completion") return "/roadmap/allocation"; return "/today"; }
function riskActionLabel(risk: AnalyticsRiskItemDto) { if (risk.type === "weak_node") return "处理薄弱节点"; if (risk.type === "note_review" || risk.type === "mistake_review") return "开始复习"; if (risk.type === "review_gap") return "完成今日复盘"; if (risk.type === "low_completion") return "调整七日计划"; return "返回今日行动"; }
function riskTone(severity: AnalyticsRiskItemDto["severity"]) { if (severity === "danger") return "text-sm font-medium text-rose-200"; if (severity === "warning") return "text-sm font-medium text-amber-200"; return "text-sm font-medium text-zinc-200"; }
function severityTone(severity: AnalyticsRiskItemDto["severity"]): "danger" | "warning" | "info" { return severity === "danger" ? "danger" : severity === "warning" ? "warning" : "info"; }
