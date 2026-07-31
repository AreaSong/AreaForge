import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { getAnalyticsSummary, type AnalyticsRiskItemDto } from "@/lib/study/analytics-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/stage/analytics");

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
    <section className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-teal-300">阶段</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">{windowDays} 天趋势</h1>
        </div>
        <div className="inline-flex rounded-md border border-white/10 p-1" aria-label="趋势周期">
          <WindowLink days={7} active={windowDays === 7} />
          <WindowLink days={30} active={windowDays === 30} />
        </div>
      </header>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="有效投入" value={`${analytics.totals.weekEffectiveMinutes} 分`} />
        <Metric label="任务完成率" value={`${Math.round(analytics.totals.weeklyTaskCompletionRate * 100)}%`} />
        <Metric label="连续学习" value={`${analytics.totals.streakDays} 天`} />
        <Metric label="低转化活动" value={`${analytics.totals.lowConversionCount} 次`} />
      </dl>

      <section className="space-y-3" aria-labelledby="daily-trend-title">
        <div className="flex items-center justify-between gap-3">
          <h2 id="daily-trend-title" className="text-lg font-medium text-white">每日投入</h2>
          <span className="text-xs text-zinc-500">总计 / 有效</span>
        </div>
        <div className="overflow-x-auto rounded-md border border-white/10 p-4">
          <div className="flex min-w-max items-end gap-2">
            {analytics.daily.map((point) => {
              const maxMinutes = Math.max(60, ...analytics.daily.map((item) => item.totalMinutes));
              const totalHeight = Math.max(3, Math.round((point.totalMinutes / maxMinutes) * 112));
              const effectiveHeight = Math.max(0, Math.round((point.effectiveMinutes / maxMinutes) * 112));
              return (
                <div key={point.dayKey} className="w-9 text-center">
                  <div
                    className="relative mx-auto h-28 w-5 rounded-sm bg-white/10"
                    aria-label={`${formatDay(point.dayKey)}：总计 ${point.totalMinutes} 分钟，有效 ${point.effectiveMinutes} 分钟`}
                    role="img"
                  >
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

      <section className="space-y-3" aria-labelledby="subject-share-title">
        <h2 id="subject-share-title" className="text-lg font-medium text-white">科目投入</h2>
        <div className="divide-y divide-white/10 border-y border-white/10">
          {analytics.subjects.map((subject) => (
            <div key={subject.subjectId} className="grid gap-2 py-3 sm:grid-cols-[10rem_1fr_7rem] sm:items-center">
              <span className="truncate text-sm text-zinc-200">{subject.subjectName}</span>
              <div className="h-2 overflow-hidden rounded bg-white/10" aria-hidden="true">
                <div className="h-full rounded bg-teal-400" style={{ width: `${subject.share}%` }} />
              </div>
              <span className="text-xs text-zinc-500 sm:text-right">{subject.effectiveMinutes} 分 · {subject.share}%</span>
            </div>
          ))}
          {analytics.subjects.length === 0 ? <p className="py-5 text-sm text-zinc-500">当前周期没有科目投入。</p> : null}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="long-term-risk-title">
        <h2 id="long-term-risk-title" className="text-lg font-medium text-white">长期风险</h2>
        {analytics.risks.length > 0 ? (
          <ul className="divide-y divide-white/10 border-y border-white/10">
            {analytics.risks.map((risk) => (
              <li key={`${risk.type}-${risk.id}`} className="py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className={riskTone(risk.severity)}>{risk.title}</p>
                    <p className="mt-1 text-sm text-zinc-400">{risk.detail}</p>
                  </div>
                  <Link className="text-sm text-teal-300 hover:underline" href={riskHref(risk)}>查看来源</Link>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-y border-white/10 py-5 text-sm text-zinc-500">当前周期没有需要升级处理的长期风险。</p>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={primaryRisk ? riskHref(primaryRisk) : "/today"}
          className="inline-flex h-11 items-center rounded-md bg-teal-500 px-4 text-sm font-medium text-black"
        >
          打开下一步来源
        </Link>
        <p className="text-sm text-zinc-500">{analytics.actions[0] ?? "保持当前行动节奏。"}</p>
      </div>
    </section>
  );
}

function WindowLink({ days, active }: { days: 7 | 30; active: boolean }) {
  return <Link href={`/stage/analytics?window=${days}`} aria-current={active ? "page" : undefined} className={`rounded px-3 py-1.5 text-sm ${active ? "bg-white/10 text-white" : "text-zinc-400"}`}>{days} 天</Link>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="border-l-2 border-teal-400/50 py-1 pl-3"><dt className="text-xs text-zinc-500">{label}</dt><dd className="mt-1 text-xl text-white">{value}</dd></div>;
}

function formatDay(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(value));
}

function riskHref(risk: AnalyticsRiskItemDto): string {
  if (risk.type === "weak_node" && risk.syllabusNodeId) return `/knowledge/syllabus/${risk.syllabusNodeId}`;
  if (risk.type === "note_review" || risk.type === "mistake_review") return "/knowledge/reviews";
  if (risk.type === "review_gap") return "/review/daily";
  if (risk.type === "low_completion") return "/today/plan";
  return "/today";
}

function riskTone(severity: AnalyticsRiskItemDto["severity"]): string {
  if (severity === "danger") return "text-sm font-medium text-rose-200";
  if (severity === "warning") return "text-sm font-medium text-amber-200";
  return "text-sm font-medium text-zinc-200";
}
