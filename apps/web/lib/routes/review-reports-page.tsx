import { CalendarRange, CheckCircle2, ClipboardList, Target } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ReportDecisionActions } from "@/components/report-decision-actions";
import { ReportHistoryList } from "@/components/report-history-list";
import { Card } from "@/components/ui/card";
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
        <Card variant="master" className="p-6 space-y-4">
          <SectionHeader title={`${period === "week" ? "周" : "月"}报告历史`} description="历史记录是当时冻结的事实与决策，只能回放，不能再次应用。" />
          <ReportHistoryList history={history} period={period} />
        </Card>
      ) : (
        <div className="space-y-6">
          <Card
            variant="master"
            className="p-6"
            data-confirmation-fields="report.strategy.canAutoApply report.strategy.requiresUserConfirmation report.aiDraft.canAutoApply report.aiDraft.requiresUserConfirmation report.decisionPreview.canAutoApply report.decisionPreview.requiresUserConfirmation"
            data-risk-surface="长期风险"
          >
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                  <CalendarRange size={14} className="text-teal-300" aria-hidden="true" />
                  <span>{formatDateRange(report.range.start, report.range.end)}</span>
                  <span>· {report.range.days} 天</span>
                </div>
                <div>
                  <span className="text-xs font-semibold text-amber-300">本周期唯一最大短板</span>
                  <h2 className="mt-1 text-xl sm:text-2xl font-bold text-white break-words">{report.weakness.title}</h2>
                </div>
                <p className="text-sm leading-relaxed text-zinc-300">{report.weakness.detail}</p>
              </div>
              <Card variant="accent" className="p-5 space-y-2.5 border-teal-500/30 shadow-[0_0_16px_rgba(45,212,191,0.1)]">
                <p className="flex items-center gap-2 text-xs font-semibold text-teal-300"><Target size={15} aria-hidden="true" />下周期只压这一件事</p>
                <p className="text-base font-semibold leading-snug text-white">{report.strategy.mustPressIssue}</p>
                <p className="text-xs leading-relaxed text-zinc-400">{report.strategy.calmConclusion}</p>
              </Card>
            </div>
          </Card>

          <ReportDecisionActions report={report} returnTo={currentReportHref} />

          <Card variant="master" className="p-6 space-y-4" aria-labelledby="report-facts-heading">
            <SectionHeader title="执行事实" description="以下数据来自本周期任务、专注与复盘记录，不是建议。" />
            <dl id="report-facts-heading" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <Card variant="subtle" className="p-3.5"><Metric label="有效学习" value={`${report.metrics.effectiveMinutes} 分`} valueSize="lg" /></Card>
              <Card variant="subtle" className="p-3.5"><Metric label="任务完成" value={formatPercent(report.metrics.taskCompletionRate)} note={`${report.metrics.completedTaskCount}/${report.metrics.taskCount} 项`} valueSize="lg" /></Card>
              <Card variant="subtle" className="p-3.5"><Metric label="复盘完成" value={formatPercent(report.metrics.reviewCompletionRate)} note={`${report.metrics.reviewCount} 次`} valueSize="lg" /></Card>
              <Card variant="subtle" className="p-3.5"><Metric label="欠账" value={`${report.metrics.debtCount} 项`} valueSize="lg" /></Card>
              <Card variant="subtle" className="p-3.5"><Metric label="低转化" value={`${report.metrics.lowConversionCount} 次`} valueSize="lg" /></Card>
              <Card variant="subtle" className="p-3.5"><Metric label="待复习证据" value={`${report.metrics.dueNoteCount} 项`} note={`${report.metrics.weakNodeCount} 个薄弱节点`} valueSize="lg" /></Card>
            </dl>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card variant="master" className="lg:col-span-2 p-6 space-y-4">
              <SectionHeader
                title={report.decisionPreview.nextCycleDraft.title}
                description="本地规则生成的待确认草稿；确认报告后逐项进入投入草稿，仍不会直接变成正式任务。"
                meta={<Badge tone="warning">待确认草稿</Badge>}
              />
              <ol className="divide-y divide-white/10">
                {report.decisionPreview.nextCycleDraft.actions.map((action, index) => (
                  <li key={action} className="flex items-start gap-3 py-3 text-sm leading-relaxed text-zinc-300">
                    <span className="grid size-6 shrink-0 place-items-center rounded-lg border border-teal-400/30 bg-teal-400/10 text-xs font-semibold text-teal-200">{index + 1}</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ol>
              <div className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs leading-relaxed text-zinc-300">
                <ClipboardList className="mt-0.5 size-4 shrink-0 text-teal-300" aria-hidden="true" />
                <p>阶段建议：{report.decisionPreview.nextCycleDraft.stageAdjustment}</p>
              </div>
            </Card>

            <Card variant="subtle" className="p-6 space-y-4">
              <SectionHeader title="判断依据" description="规则为何把它选为当前最大短板。" />
              <ul className="space-y-3 text-xs leading-relaxed text-zinc-300">
                {report.weakness.reasons.map((reason) => (
                  <li key={reason} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal-400" aria-hidden="true" />
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card variant="master" className="p-6 space-y-4">
            <SectionHeader title="科目投入" description="有效时长占比用于解释投入分布，不直接代表掌握程度。" />
            {report.subjectShares.length ? (
              <div className="divide-y divide-white/5">
                {report.subjectShares.map((subject) => (
                  <div key={subject.subjectId} className="af-content-grid-bar grid gap-2 py-3 items-center">
                    <span className="break-words text-sm font-medium text-zinc-200">{subject.subjectName}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${subject.share}%`, backgroundColor: subject.subjectColor }} />
                    </div>
                    <span className="text-xs text-zinc-400">{subject.effectiveMinutes} 分 · {subject.share}%</span>
                  </div>
                ))}
              </div>
            ) : <p className="py-4 text-xs text-zinc-500">当前周期还没有可统计的科目投入。</p>}
          </Card>
        </div>
      )}
    </PageFrame>
  );
}

function ReportFilter({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-xl border px-3.5 py-1.5 text-xs font-medium transition-all ${
        active
          ? "border-teal-500/30 bg-teal-400/10 text-teal-200 shadow-[0_0_12px_rgba(45,212,191,0.15)]"
          : "border-white/5 bg-white/[0.02] text-zinc-400 hover:border-white/10 hover:text-white"
      }`}
    >
      {children}
    </Link>
  );
}

function decisionLabel(status?: "confirmed" | "rejected") { return status === "confirmed" ? "已确认并冻结" : status === "rejected" ? "已驳回" : "等待你的决定"; }
function decisionTone(status?: "confirmed" | "rejected"): "success" | "neutral" | "warning" { return status === "confirmed" ? "success" : status === "rejected" ? "neutral" : "warning"; }

