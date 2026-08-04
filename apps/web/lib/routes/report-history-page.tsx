import { ArrowLeft, ClipboardList, Milestone } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { BackToListLink } from "@/components/list-return-context";
import { ButtonLink } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/responses";
import { getRouteMetadata, withReturnTo } from "@/lib/navigation/batch7";
import { getPeriodicReportDecision } from "@/lib/study/report-decisions-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap/reports/history/decision");

export default async function ReportHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ decisionId: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [{ decisionId }, query] = await Promise.all([params, searchParams]);
  const period = query.period === "month" ? "month" : "week";
  const decision = await getPeriodicReportDecision(decisionId, user.id).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  const snapshot = decision.reportSnapshot;
  const historyHref = `/roadmap/reports/history/${decision.id}?period=${period}`;

  return (
    <PageFrame variant="content-focus">
      <PageHeader
        eyebrow={decision.kind === "month" ? "月报告历史" : "周报告历史"}
        title="冻结报告回放"
        description={`${formatDateRange(decision.range.start, decision.range.end)} · ${new Date(decision.decidedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`}
        back={(
          <BackToListLink fallbackHref={`/roadmap/reports?tab=history&period=${period}`} className="inline-flex items-center gap-2 text-sm text-teal-300">
            <ArrowLeft size={15} aria-hidden="true" />返回报告历史
          </BackToListLink>
        )}
        status={<Badge tone={decision.status === "confirmed" ? "success" : "neutral"}>{decision.status === "confirmed" ? "当时已确认" : "当时已驳回"}</Badge>}
      />

      <Alert tone="info" title="这是历史快照">
        页面只回放当时的事实、结论和生成结果，不会重新计算，也不能再次确认或应用。
      </Alert>

      <section className="space-y-4">
        <SectionHeader title="当时的执行事实" />
        <dl className="grid grid-cols-2 divide-x divide-y divide-white/10 border-y border-white/10 sm:grid-cols-4">
          <Metric label="有效学习" value={`${snapshot.metrics.effectiveMinutes} 分`} />
          <Metric label="任务完成" value={formatPercent(snapshot.metrics.taskCompletionRate)} />
          <Metric label="复盘完成" value={formatPercent(snapshot.metrics.reviewCompletionRate)} />
          <Metric label="欠账" value={`${snapshot.metrics.debtCount} 项`} />
        </dl>
      </section>

      <section className="space-y-4 border-b border-white/10 pb-6">
        <SectionHeader title="当时的最大短板" meta={<Badge tone="warning">规则判断</Badge>} />
        <div>
          <h2 className="text-lg font-medium text-white">{snapshot.weakness.title}</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-300">{snapshot.weakness.detail}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-zinc-500">
            {snapshot.weakness.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
      </section>

      <section className="space-y-4 border-b border-white/10 pb-6">
        <SectionHeader title="当时的决策" meta={<Badge tone={decision.status === "confirmed" ? "success" : "neutral"}>{decision.status === "confirmed" ? "已确认" : "已驳回"}</Badge>} />
        {decision.status === "confirmed" ? (
          <div className="space-y-3 text-sm leading-6">
            <p className="font-medium text-zinc-200">下周期焦点：{decision.nextCycleDraft?.focus ?? snapshot.strategy.mustPressIssue}</p>
            <p className="text-zinc-400">阶段建议：{snapshot.nextCycleDraft.stageAdjustment}</p>
            <p className="text-zinc-500">该次确认只生成草稿；没有自动修改阶段计划或现有任务。</p>
          </div>
        ) : <p className="text-sm leading-6 text-zinc-400">该次报告被驳回，没有创建阶段草稿，也没有写入下一周期行动。</p>}
      </section>

      <section className="space-y-4">
        <SectionHeader title="当时的生成结果" description="这里只保留汇总数量，不能据此推断每条草稿当前是否已转成任务。" />
        <dl className="grid grid-cols-3 divide-x divide-white/10 border-y border-white/10">
          <Metric label="新增草稿" value={`${decision.inboxResult.createdCount} 项`} />
          <Metric label="复用" value={`${decision.inboxResult.reusedCount} 项`} />
          <Metric label="被替代" value={`${decision.inboxResult.supersededCount} 项`} />
        </dl>
        <div className="flex flex-wrap gap-2">
          {decision.inboxResult.createdCount + decision.inboxResult.reusedCount > 0 ? <ButtonLink href={withReturnTo("/roadmap/arrangements/drafts", historyHref)} variant="secondary"><ClipboardList size={15} aria-hidden="true" />查看当前收件箱</ButtonLink> : null}
          {decision.stageDraftId ? <ButtonLink href="/roadmap/stages" variant="secondary"><Milestone size={15} aria-hidden="true" />查看当前阶段</ButtonLink> : null}
        </div>
      </section>
    </PageFrame>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 px-3 py-4"><dt className="text-xs text-zinc-500">{label}</dt><dd className="mt-1 break-words text-base font-medium text-zinc-200">{value}</dd></div>;
}

function formatPercent(value: number) { return `${Math.round(value * 100)}%`; }
function formatDateRange(start: string, end: string) { return `${new Date(start).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })} 至 ${new Date(end).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}`; }
