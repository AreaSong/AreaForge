import {
  ArrowLeft,
  BarChart3,
  Clock3,
  FileWarning,
  NotebookText,
  PieChart,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandBreadcrumb } from "@/components/brand-logo";
import { LongTermRiskPanel } from "@/components/long-term-risk-panel";
import { getCurrentUser } from "@/lib/auth/session";
import { getAnalyticsSummary, type AnalyticsRiskItemDto } from "@/lib/study/analytics-service";
import { getLongTermRiskSummary } from "@/lib/study/long-term-risk-service";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [analytics, longTermRisks] = await Promise.all([
    getAnalyticsSummary(new Date(), user.id),
    getLongTermRiskSummary(),
  ]);

  return (
    <main className="min-h-screen bg-[#080b0f] text-zinc-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <BrandBreadcrumb section="Analytics" />
            <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
              基础统计
            </h1>
            <p className="mt-2 text-sm text-zinc-500">近 7 天派生统计，每个指标都对应下一步动作。</p>
          </div>
          <Link
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10"
            href="/"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            返回作战台
          </Link>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile icon={Clock3} label="本周投入" value={`${analytics.totals.weekMinutes} 分`} sub={`有效 ${analytics.totals.weekEffectiveMinutes} 分`} />
          <StatTile icon={BarChart3} label="任务完成率" value={formatPercent(analytics.totals.weeklyTaskCompletionRate)} sub={`今日 ${formatPercent(analytics.totals.dailyTaskCompletionRate)}`} />
          <StatTile icon={RotateCcw} label="连续性" value={`${analytics.totals.streakDays} 天`} sub={`近 7 天断签 ${analytics.totals.missedDays} 天`} />
          <StatTile icon={NotebookText} label="复盘完成率" value={formatPercent(analytics.totals.reviewCompletionRate)} sub={`错题 ${analytics.totals.totalMistakes} 条`} />
        </section>

        <LongTermRiskPanel
          summary={longTermRisks}
          title="长期风险"
          description="统计页读取同一长期风险 DTO，证据新鲜度和下一步动作与报告、考纲、笔记、模拟保持一致。"
        />

        <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-lg border border-white/10 bg-[#101419] p-5">
            <div className="flex items-center gap-2">
              <PieChart className="h-5 w-5 text-teal-300" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-white">科目投入占比</h2>
            </div>
            <div className="mt-5 grid gap-3">
              {analytics.subjects.map((subject) => (
                <div key={subject.subjectId} className="rounded-md border border-white/10 bg-[#151a20] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-zinc-300">{subject.subjectName}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        总投入 {subject.totalMinutes} 分 / 有效 {subject.effectiveMinutes} 分
                      </p>
                    </div>
                    <span className="shrink-0 text-sm text-zinc-200">{subject.share}%</span>
                  </div>
                  <div className="mt-3 h-2 rounded-md bg-white/10">
                    <div className="h-2 rounded-md" style={{ width: `${subject.share}%`, backgroundColor: subject.subjectColor }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#101419] p-5">
            <div className="flex items-center gap-2">
              <FileWarning className="h-5 w-5 text-amber-300" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-white">下一步动作</h2>
            </div>
            <div className="mt-5 grid gap-3">
              {analytics.actions.map((action) => (
                <p key={action} className="rounded-md border border-teal-300/20 bg-teal-300/10 px-4 py-3 text-sm leading-6 text-teal-50">
                  {action}
                </p>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-lg border border-white/10 bg-[#101419] p-5">
            <h2 className="text-lg font-semibold text-white">每日趋势</h2>
            <div className="mt-5 grid gap-3">
              {analytics.daily.map((point) => (
                <div key={point.dayKey} className="grid gap-3 rounded-md border border-white/10 bg-[#151a20] p-4 sm:grid-cols-[8rem_1fr_auto] sm:items-center">
                  <p className="text-sm text-zinc-300">{point.dayKey}</p>
                  <div className="h-2 rounded-md bg-white/10">
                    <div
                      className="h-2 rounded-md bg-teal-400"
                      style={{ width: `${Math.min(100, Math.round((point.effectiveMinutes / 240) * 100))}%` }}
                    />
                  </div>
                  <p className="text-sm text-zinc-400">
                    {point.effectiveMinutes}/{point.totalMinutes} 分 · {formatPercent(point.taskCompletionRate)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#101419] p-5">
            <h2 className="text-lg font-semibold text-white">风险与提醒</h2>
            <div className="mt-5 grid gap-3">
              {analytics.risks.length === 0 ? (
                <p className="rounded-md border border-dashed border-white/10 px-4 py-6 text-sm text-zinc-400">
                  近 7 天没有触发明确风险提醒，继续把产出关联到任务或考纲节点。
                </p>
              ) : null}
              {analytics.risks.map((risk) => (
                <RiskCard key={risk.id} risk={risk} />
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#101419] p-4">
      <Icon className="h-5 w-5 text-teal-300" aria-hidden="true" />
      <p className="mt-4 text-sm text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{sub}</p>
    </div>
  );
}

function RiskCard({ risk }: { risk: AnalyticsRiskItemDto }) {
  const tone = {
    info: "border-sky-300/20 bg-sky-300/10 text-sky-50",
    warning: "border-amber-300/20 bg-amber-300/10 text-amber-50",
    danger: "border-rose-300/20 bg-rose-300/10 text-rose-50",
  }[risk.severity];

  return (
    <article className={`rounded-md border p-4 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-white">{risk.title}</h3>
          <p className="mt-2 text-sm leading-6">{risk.detail}</p>
        </div>
        {risk.dueAt ? <span className="shrink-0 text-xs opacity-75">{new Date(risk.dueAt).toLocaleDateString("zh-CN")}</span> : null}
      </div>
      {risk.syllabusNodeTitle ? <p className="mt-2 text-xs opacity-75">节点：{risk.syllabusNodeTitle}</p> : null}
      <p className="mt-3 text-sm text-white">{risk.action}</p>
    </article>
  );
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
