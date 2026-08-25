import { CalendarRange, CheckCircle2, ClipboardList, Target } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ReportDecisionActions } from "@/components/report-decision-actions";
import { ReportHistoryList } from "@/components/report-history-list";
import { Badge } from "@/components/ui/feedback";
import { Metric } from "@/components/ui/metric";
import { PageFrame, PageHeader, SectionHeader, Toolbar } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { formatDateRange, formatPercent } from "@/lib/formatters";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { listPeriodicReportDecisions } from "@/lib/study/report-decisions-service";
import { getPeriodicReport, type PeriodicReportKind } from "@/lib/study/reports-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap/reviews");

export default async function ReviewReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; period?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const tab = query.tab === "history" ? "history" : "current";
  const period: PeriodicReportKind = query.period === "month" ? "month" : "week";
  const currentReportHref = `/roadmap/reviews?tab=current&period=${period}`;
  const [report, history] = await Promise.all([
    getPeriodicReport(period, new Date(), user.id),
    listPeriodicReportDecisions(period, user.id),
  ]);

  return (
    <PageFrame variant="dashboard-wide">
      <PageHeader
        eyebrow="复盘"
        title="周期复盘"
        description="先核对本周期事实，再决定是否把下一周期策略送入投入草稿。"
        status={<Badge tone={decisionTone(report.decision?.status)}>{decisionLabel(report.decision?.status)}</Badge>}
      />

      <Toolbar label="报告视图与周期">
        <ReportFilter href={`/roadmap/reviews?tab=current&period=${period}`} active={tab === "current"}>当前报告</ReportFilter>
        <ReportFilter href={`/roadmap/reviews?tab=history&period=${period}`} active={tab === "history"}>历史回放</ReportFilter>
        <span className="mx-1 h-6 w-px bg-white/10" aria-hidden="true" />
        <ReportFilter href={`/roadmap/reviews?tab=${tab}&period=week`} active={period === "week"}>周</ReportFilter>
        <ReportFilter href={`/roadmap/reviews?tab=${tab}&period=month`} active={period === "month"}>月</ReportFilter>
      </Toolbar>

      {tab === "history" ? (
        <section className="space-y-4">
          <SectionHeader title={`${period === "week" ? "周" : "月"}报告历史`} description="历史记录是当时冻结的事实与决策，只能回放，不能再次应用。" />
          <ReportHistoryList history={history} period={period} />
        </section>
      ) : (
        <div className="space-y-7">
          <section
            className="af-content-grid-sidebar grid gap-6 border-b border-white/10 pb-7"
            data-confirmation-fields="report.strategy.canAutoApply report.strategy.requiresUserConfirmation report.aiDraft.canAutoApply report.aiDraft.requiresUserConfirmation report.decisionPreview.canAutoApply report.decisionPreview.requiresUserConfirmation"
            data-risk-surface="长期风险"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <CalendarRange size={15} aria-hidden="true" />
                <span>{formatDateRange(report.range.start, report.range.end)}</span>
                <span>· {report.range.days} 天</span>
              </div>
              <p className="mt-5 text-xs font-medium text-amber-200">本周期唯一最大短板</p>
              <h2 className="mt-2 max-w-4xl break-words text-2xl font-semibold leading-9 text-white">{report.weakness.title}</h2>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-zinc-400">{report.weakness.detail}</p>
            </div>
            <div className="af-responsive-aside">
              <p className="flex items-center gap-2 text-xs font-medium text-teal-300"><Target size={15} aria-hidden="true" />下周期只压这一件事</p>
              <p className="mt-2 text-base font-medium leading-7 text-zinc-100">{report.strategy.mustPressIssue}</p>
              <p className="mt-3 text-sm leading-6 text-zinc-500">{report.strategy.calmConclusion}</p>
            </div>
          </section>

          <ReportDecisionActions report={report} returnTo={currentReportHref} />

          <section className="space-y-4" aria-labelledby="report-facts-heading">
            <SectionHeader title="执行事实" description="以下数据来自本周期任务、专注与复盘记录，不是建议。" />
            <dl id="report-facts-heading" className="af-metric-grid-six grid divide-x divide-y divide-white/10 border-y border-white/10">
              <Metric label="有效学习" value={`${report.metrics.effectiveMinutes} 分`} valueSize="lg" />
              <Metric label="任务完成" value={formatPercent(report.metrics.taskCompletionRate)} note={`${report.metrics.completedTaskCount}/${report.metrics.taskCount} 项`} valueSize="lg" />
              <Metric label="复盘完成" value={formatPercent(report.metrics.reviewCompletionRate)} note={`${report.metrics.reviewCount} 次`} valueSize="lg" />
              <Metric label="欠账" value={`${report.metrics.debtCount} 项`} valueSize="lg" />
              <Metric label="低转化" value={`${report.metrics.lowConversionCount} 次`} valueSize="lg" />
              <Metric label="待复习证据" value={`${report.metrics.dueNoteCount} 项`} note={`${report.metrics.weakNodeCount} 个薄弱节点`} valueSize="lg" />
            </dl>
          </section>

          <section className="af-content-grid-inspector grid gap-7">
            <div className="space-y-4">
              <SectionHeader
                title={report.decisionPreview.nextCycleDraft.title}
                description="本地规则生成的待确认草稿；确认报告后逐项进入投入草稿，仍不会直接变成正式任务。"
                meta={<Badge tone="warning">待确认草稿</Badge>}
              />
              <ol className="divide-y divide-white/10 border-y border-white/10">
                {report.decisionPreview.nextCycleDraft.actions.map((action, index) => (
                  <li key={action} className="flex gap-3 py-4 text-sm leading-6 text-zinc-300">
                    <span className="grid size-6 shrink-0 place-items-center rounded-md border border-white/10 text-xs text-zinc-500">{index + 1}</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ol>
              <div className="flex items-start gap-3 border-l-2 border-white/10 pl-4 text-sm leading-6 text-zinc-400">
                <ClipboardList className="mt-1 size-4 shrink-0" aria-hidden="true" />
                <p>阶段建议：{report.decisionPreview.nextCycleDraft.stageAdjustment}</p>
              </div>
            </div>

            <div className="af-responsive-aside space-y-4">
              <SectionHeader title="判断依据" description="规则为何把它选为当前最大短板。" />
              <ul className="space-y-3 text-sm leading-6 text-zinc-400">
                {report.weakness.reasons.map((reason) => <li key={reason} className="flex gap-2"><CheckCircle2 className="mt-1 size-4 shrink-0 text-zinc-600" aria-hidden="true" /><span>{reason}</span></li>)}
              </ul>
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeader title="科目投入" description="有效时长占比用于解释投入分布，不直接代表掌握程度。" />
            {report.subjectShares.length ? (
              <div className="divide-y divide-white/10 border-y border-white/10">
                {report.subjectShares.map((subject) => (
                  <div key={subject.subjectId} className="af-content-grid-bar grid gap-2 py-3">
                    <span className="break-words text-sm text-zinc-200">{subject.subjectName}</span>
                    <div className="h-2 overflow-hidden rounded bg-white/10" aria-hidden="true"><div className="h-full rounded" style={{ width: `${subject.share}%`, backgroundColor: subject.subjectColor }} /></div>
                    <span className="text-xs text-zinc-500">{subject.effectiveMinutes} 分 · {subject.share}%</span>
                  </div>
                ))}
              </div>
            ) : <p className="border-y border-white/10 py-5 text-sm text-zinc-500">当前周期还没有可统计的科目投入。</p>}
          </section>
        </div>
      )}
    </PageFrame>
  );
}

function ReportFilter({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return <Link href={href} aria-current={active ? "page" : undefined} className={`rounded-md px-3 py-2 text-sm ${active ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-200"}`}>{children}</Link>;
}

function decisionLabel(status?: "confirmed" | "rejected") { return status === "confirmed" ? "已确认并冻结" : status === "rejected" ? "已驳回" : "等待你的决定"; }
function decisionTone(status?: "confirmed" | "rejected"): "success" | "neutral" | "warning" { return status === "confirmed" ? "success" : status === "rejected" ? "neutral" : "warning"; }
