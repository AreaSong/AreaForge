import Link from "next/link";
import { redirect } from "next/navigation";
import { ReportDecisionActions } from "@/components/report-decision-actions";
import { getCurrentUser } from "@/lib/auth/session";
import { listPeriodicReportDecisions } from "@/lib/study/report-decisions-service";
import { getPeriodicReport, type PeriodicReportKind } from "@/lib/study/reports-service";

export const dynamic = "force-dynamic";

export default async function ReviewReportsPage({ searchParams }: { searchParams: Promise<{ tab?: string; period?: string }> }) {
  const user = await getCurrentUser(); if (!user) redirect("/login");
  const query = await searchParams; const tab = query.tab === "history" ? "history" : "current"; const period: PeriodicReportKind = query.period === "month" ? "month" : "week";
  const [report, history] = await Promise.all([getPeriodicReport(period, new Date(), user.id), listPeriodicReportDecisions(period, user.id)]);
  const decisionStatus = report.decision
    ? report.decision.status === "confirmed" ? "已确认" : "已驳回"
    : "待确认";
  return <section className="space-y-5"><div><p className="text-sm text-teal-300">复盘</p><h1 className="text-2xl font-semibold text-white">周期报告</h1><p className="mt-1 text-sm text-zinc-400">确认冻结当前版本；报告与阶段确认保持独立。</p></div><div className="flex flex-wrap gap-2" aria-label="报告筛选"><Link href={`/review/reports?tab=current&period=${period}`} className={`rounded-md border px-3 py-2 text-sm ${tab === "current" ? "border-teal-400 text-teal-200" : "border-white/10 text-zinc-400"}`}>当前</Link><Link href={`/review/reports?tab=history&period=${period}`} className={`rounded-md border px-3 py-2 text-sm ${tab === "history" ? "border-teal-400 text-teal-200" : "border-white/10 text-zinc-400"}`}>历史</Link><Link href={`/review/reports?tab=${tab}&period=week`} className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-300">周</Link><Link href={`/review/reports?tab=${tab}&period=month`} className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-300">月</Link></div>{tab === "history" ? <div className="grid gap-3">{history.map((decision) => <Link key={decision.id} href={`/review/reports/history/${decision.id}?period=${period}`} className="rounded-md border border-white/10 bg-[#101419] p-4"><div className="flex justify-between"><span className="text-white">{decision.kind === "week" ? "周报告" : "月报告"}</span><span className="text-xs text-zinc-500">{decision.status === "confirmed" ? "已确认" : "已驳回"}</span></div><p className="mt-2 text-sm text-zinc-400">{new Date(decision.range.start).toLocaleDateString("zh-CN")} - {new Date(decision.range.end).toLocaleDateString("zh-CN")}</p></Link>)}</div> : <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-3"><Metric label="计划完成率" value={`${Math.round(report.metrics.taskCompletionRate * 100)}%`}/><Metric label="最大短板" value={report.weakness.title}/><Metric label="下一步" value={report.strategy.nextActions[0] ?? report.strategy.mustPressIssue}/></div><div className="rounded-md border border-white/10 bg-[#101419] p-4"><p className="text-xs text-zinc-500">当前决策状态</p><p className="mt-1 text-sm text-white">{decisionStatus}</p><p className="mt-3 text-sm leading-6 text-zinc-300">{report.strategy.calmConclusion}</p><div className="mt-4"><ReportDecisionActions report={report}/></div></div></div>}</section>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-md border border-white/10 bg-[#101419] p-4"><p className="text-xs text-zinc-500">{label}</p><p className="mt-2 text-sm text-white">{value}</p></div>; }
