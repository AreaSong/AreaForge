import Link from "next/link";
import { redirect } from "next/navigation";
import { ReportDecisionActions } from "@/components/report-decision-actions";
import { ReportHistoryList } from "@/components/report-history-list";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { listPeriodicReportDecisions } from "@/lib/study/report-decisions-service";
import { getPeriodicReport, type PeriodicReportKind } from "@/lib/study/reports-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/review/reports");

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
  const [report, history] = await Promise.all([
    getPeriodicReport(period, new Date(), user.id),
    listPeriodicReportDecisions(period, user.id),
  ]);
  const decisionStatus = report.decision
    ? report.decision.status === "confirmed" ? "已确认" : "已驳回"
    : "待确认";

  return (
    <section className="space-y-5">
      <header className="border-b border-white/10 pb-4">
        <h1 className="text-xl font-semibold text-white">周期报告</h1>
        <p className="mt-1 text-sm text-zinc-500">回顾执行结果，确认下一周期的调整</p>
      </header>
      <nav className="flex flex-wrap gap-1" aria-label="报告筛选">
        <ReportFilter href={`/review/reports?tab=current&period=${period}`} active={tab === "current"}>当前</ReportFilter>
        <ReportFilter href={`/review/reports?tab=history&period=${period}`} active={tab === "history"}>历史</ReportFilter>
        <span className="mx-1 w-px bg-white/10" aria-hidden="true" />
        <ReportFilter href={`/review/reports?tab=${tab}&period=week`} active={period === "week"}>周</ReportFilter>
        <ReportFilter href={`/review/reports?tab=${tab}&period=month`} active={period === "month"}>月</ReportFilter>
      </nav>

      {tab === "history" ? <ReportHistoryList history={history} period={period} /> : (
        <div className="space-y-5">
          <dl className="grid divide-y divide-white/10 border-y border-white/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <Metric label="计划完成率" value={`${Math.round(report.metrics.taskCompletionRate * 100)}%`} />
            <Metric label="最大短板" value={report.weakness.title} />
            <Metric label="下一步" value={report.strategy.nextActions[0] ?? report.strategy.mustPressIssue} />
          </dl>
          <section>
            <p className="text-xs text-zinc-500">当前状态</p>
            <p className="mt-1 text-sm text-white">{decisionStatus}</p>
            <p className="mt-3 text-sm leading-6 text-zinc-300">{report.strategy.calmConclusion}</p>
            <ReportDecisionActions report={report} />
          </section>
        </div>
      )}
    </section>
  );
}

function ReportFilter({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return <Link href={href} aria-current={active ? "page" : undefined} className={`rounded-md px-3 py-2 text-sm ${active ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-200"}`}>{children}</Link>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="px-1 py-3 sm:px-4"><dt className="text-xs text-zinc-500">{label}</dt><dd className="mt-1 text-sm leading-6 text-zinc-100">{value}</dd></div>;
}
