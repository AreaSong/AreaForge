import { ArrowRight, BarChart3, CalendarDays, CircleCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/feedback";
import { PageFrame, PageHeader, SectionHeader, Toolbar } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
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

      <section className="grid gap-6 border-b border-white/10 pb-7 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)] lg:items-center">
        <div className="min-w-0">
          <p className={`flex items-center gap-2 text-xs font-medium ${primaryRisk ? riskTone(primaryRisk.severity) : "text-emerald-200"}`}>
            {primaryRisk ? <TriangleAlert size={15} aria-hidden="true" /> : <CircleCheck size={15} aria-hidden="true" />}
            {primaryRisk ? "当前最高风险" : "当前判断"}
          </p>
          <h2 className="mt-2 text-2xl font-semibold leading-9 text-white">{primaryRisk?.title ?? "当前周期没有需要升级处理的风险"}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{primaryRisk?.detail ?? "继续按当前节奏执行，并在周期复盘中确认下一阶段是否需要调整。"}</p>
          <p className="mt-3 text-sm text-zinc-500">建议：{primaryRisk?.action ?? analytics.actions[0] ?? "保持当前行动节奏。"}</p>
        </div>
        <ButtonLink href={primaryRisk ? riskHref(primaryRisk) : "/roadmap/reviews"} variant="primary" size="lg" className="w-full lg:w-auto">
          {primaryRisk ? riskActionLabel(primaryRisk) : "查看周期复盘"}<ArrowRight size={16} aria-hidden="true" />
        </ButtonLink>
      </section>

      <section className="space-y-4">
        <SectionHeader title={`${windowDays} 天执行事实`} description="这些指标用于解释趋势，不会自动创建任务或修改阶段。" />
        <dl className="grid grid-cols-2 divide-x divide-y divide-white/10 border-y border-white/10 lg:grid-cols-4">
          <Metric label="有效投入" value={`${analytics.totals.weekEffectiveMinutes} 分`} />
          <Metric label="任务完成率" value={`${Math.round(analytics.totals.weeklyTaskCompletionRate * 100)}%`} />
          <Metric label="连续学习" value={`${analytics.totals.streakDays} 天`} />
          <Metric label="低转化活动" value={`${analytics.totals.lowConversionCount} 次`} />
        </dl>
      </section>

      <section className="space-y-4" aria-labelledby="daily-trend-title">
        <SectionHeader title="每日投入" description="灰色为总计，绿色为有效学习。" meta={<span className="flex items-center gap-2 text-xs text-zinc-500"><BarChart3 size={14} aria-hidden="true" />分钟</span>} />
        <div className="overflow-x-auto border-y border-white/10 px-2 py-5 sm:px-4">
          <div id="daily-trend-title" className="flex min-w-max items-end gap-2">
            {analytics.daily.map((point) => {
              const maxMinutes = Math.max(60, ...analytics.daily.map((item) => item.totalMinutes));
              const totalHeight = Math.max(3, Math.round((point.totalMinutes / maxMinutes) * 112));
              const effectiveHeight = Math.max(0, Math.round((point.effectiveMinutes / maxMinutes) * 112));
              return (
                <div key={point.dayKey} className="w-9 text-center">
                  <div className="relative mx-auto h-28 w-5 rounded-sm bg-white/10" aria-label={`${formatDay(point.dayKey)}：总计 ${point.totalMinutes} 分钟，有效 ${point.effectiveMinutes} 分钟`} role="img">
                    <span className="absolute inset-x-0 bottom-0 rounded-sm bg-zinc-600" style={{ height: totalHeight }} />
                    <span className="absolute inset-x-0 bottom-0 rounded-sm bg-teal-400" style={{ height: effectiveHeight }} />
                  </div>
                  <span className="mt-2 block text-[11px] text-zinc-500">{formatDay(point.dayKey)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid gap-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
        <div className="space-y-4">
          <SectionHeader title="科目投入" description="占比只表示时间分配，不代表掌握程度。" />
          <div className="divide-y divide-white/10 border-y border-white/10">
            {analytics.subjects.map((subject) => (
              <div key={subject.subjectId} className="grid gap-2 py-3 sm:grid-cols-[9rem_1fr_7rem] sm:items-center">
                <span className="truncate text-sm text-zinc-200">{subject.subjectName}</span>
                <div className="h-2 overflow-hidden rounded bg-white/10" aria-hidden="true"><div className="h-full rounded" style={{ width: `${subject.share}%`, backgroundColor: subject.subjectColor }} /></div>
                <span className="text-xs text-zinc-500 sm:text-right">{subject.effectiveMinutes} 分 · {subject.share}%</span>
              </div>
            ))}
            {analytics.subjects.length === 0 ? <p className="py-5 text-sm text-zinc-500">当前周期没有科目投入。</p> : null}
          </div>
        </div>

        <div className="space-y-4 border-t border-white/10 pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <SectionHeader title="其他风险" description={primaryRisk ? "最高风险已在页面顶部前置，其余风险按严重度继续处理。" : "当前没有需要升级处理的长期风险。"} />
          {analytics.risks.length > 1 ? (
            <ul className="divide-y divide-white/10 border-y border-white/10">
              {analytics.risks.slice(1).map((risk) => (
                <li key={`${risk.type}-${risk.id}`} className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={riskTone(risk.severity)}>{risk.title}</p>
                      <p className="mt-1 text-sm leading-6 text-zinc-500">{risk.detail}</p>
                    </div>
                    <Link className="shrink-0 text-sm text-teal-300 hover:underline" href={riskHref(risk)}>{riskActionLabel(risk)}</Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="border-y border-white/10 py-5 text-sm text-zinc-500">没有其他风险需要排队处理。</p>}
        </div>
      </section>
    </PageFrame>
  );
}

function WindowLink({ days, active }: { days: 7 | 30; active: boolean }) { return <Link href={`/roadmap/stages/trend?window=${days}`} aria-current={active ? "page" : undefined} className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm ${active ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"}`}><CalendarDays size={14} aria-hidden="true" />{days} 天</Link>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="min-w-0 px-3 py-4"><dt className="text-xs text-zinc-500">{label}</dt><dd className="mt-1 break-words text-xl font-medium text-white">{value}</dd></div>; }
function formatDay(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(value)); }
function formatDateRange(start: string, end: string) { return `${new Date(start).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })} 至 ${new Date(end).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}`; }
function riskHref(risk: AnalyticsRiskItemDto) { if (risk.type === "weak_node" && risk.syllabusNodeId) return `/knowledge/syllabi/${risk.syllabusNodeId}`; if (risk.type === "note_review" || risk.type === "mistake_review") return "/knowledge/reviews"; if (risk.type === "review_gap") return "/roadmap/reviews/daily"; if (risk.type === "low_completion") return "/roadmap/allocation"; return "/today"; }
function riskActionLabel(risk: AnalyticsRiskItemDto) { if (risk.type === "weak_node") return "处理薄弱节点"; if (risk.type === "note_review" || risk.type === "mistake_review") return "开始复习"; if (risk.type === "review_gap") return "完成今日复盘"; if (risk.type === "low_completion") return "调整七日计划"; return "返回今日行动"; }
function riskTone(severity: AnalyticsRiskItemDto["severity"]) { if (severity === "danger") return "text-sm font-medium text-rose-200"; if (severity === "warning") return "text-sm font-medium text-amber-200"; return "text-sm font-medium text-zinc-200"; }
function severityTone(severity: AnalyticsRiskItemDto["severity"]): "danger" | "warning" | "info" { return severity === "danger" ? "danger" : severity === "warning" ? "warning" : "info"; }
