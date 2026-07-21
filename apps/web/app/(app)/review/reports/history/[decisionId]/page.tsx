import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { listPeriodicReportDecisions } from "@/lib/study/report-decisions-service";

export const dynamic = "force-dynamic";
export default async function ReportHistoryPage({ params, searchParams }: { params: Promise<{ decisionId: string }>; searchParams: Promise<{ period?: string }> }) {
  const user = await getCurrentUser(); if (!user) redirect("/login"); const [{ decisionId }, query] = await Promise.all([params, searchParams]);
  const decision = (await listPeriodicReportDecisions(undefined, user.id)).find((item) => item.id === decisionId); if (!decision) notFound();
  return <section className="space-y-4"><Link href={`/review/reports?tab=history&period=${query.period === "month" ? "month" : "week"}`} className="text-sm text-teal-300">← 返回报告历史</Link><h1 className="text-2xl font-semibold text-white">冻结报告</h1><div className="rounded-md border border-white/10 bg-[#101419] p-4"><p className="text-sm text-zinc-400">状态：{decision.status}</p><p className="mt-2 text-sm text-zinc-400">冻结于：{new Date(decision.decidedAt).toLocaleString("zh-CN")}</p><pre className="mt-4 overflow-auto whitespace-pre-wrap text-xs text-zinc-300">{JSON.stringify(decision.reportSnapshot, null, 2)}</pre></div></section>;
}
