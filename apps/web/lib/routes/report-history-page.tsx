import { ArrowLeft, ClipboardList, Milestone } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { BackToListLink } from "@/components/list-return-context";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, Badge } from "@/components/ui/feedback";
import { Metric } from "@/components/ui/metric";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/responses";
import {
  formatDateRange,
  formatDateTime,
  formatMinutes as formatMinutesValue,
  formatPercent as formatPercentValue,
} from "@/lib/formatters";
import { getRouteMetadata, withReturnTo } from "@/lib/navigation/app-navigation";
import { periodicReportHistoryRoute } from "@/lib/navigation/route-helpers";
import { getPeriodicReportDecision } from "@/lib/study/report-decisions-service";
import { readReportDecisionFocus, readReportHistorySnapshot } from "@/lib/study/report-history-snapshot";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap/reviews/history/decision");

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
  const snapshot = readReportHistorySnapshot(decision.reportSnapshot as unknown);
  const nextCycleFocus = readReportDecisionFocus(decision.nextCycleDraft);
  const historyHref = `${periodicReportHistoryRoute(decision.id)}?period=${period}`;

  return (
    <PageFrame variant="content-focus">
      <PageHeader
        eyebrow={decision.kind === "month" ? "月报告历史" : "周报告历史"}
        title="冻结报告回放"
        description={`${formatDateRange(decision.range.start, decision.range.end)} · ${formatDateTime(decision.decidedAt)}`}
        back={(
          <BackToListLink fallbackHref={`/roadmap/reviews?tab=history&period=${period}`} className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-teal-300 transition-colors">
            <ArrowLeft size={14} aria-hidden="true" />返回报告历史
          </BackToListLink>
        )}
        status={<Badge tone={decision.status === "confirmed" ? "success" : "neutral"}>{decision.status === "confirmed" ? "当时已确认" : "当时已驳回"}</Badge>}
      />

      <Alert tone="info" title="这是历史快照">
        {snapshot.format === "current"
          ? "页面只回放当时的事实、结论和生成结果，不会重新计算，也不能再次确认或应用。"
          : "这条早期记录只回放当时实际保存的汇总字段；未保存的复盘、欠账和判断不会补算。"}
      </Alert>

      <Card variant="master" className="p-6 space-y-4">
        <SectionHeader title="当时的执行事实" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {snapshot.format === "legacy" ? (
            <>
              <Card variant="subtle" className="p-3.5"><Metric label="总学习" value={formatNullableMinutes(snapshot.metrics.totalMinutes)} valueSize="base" /></Card>
              <Card variant="subtle" className="p-3.5"><Metric label="有效学习" value={formatNullableMinutes(snapshot.metrics.effectiveMinutes)} valueSize="base" /></Card>
              <Card variant="subtle" className="p-3.5"><Metric label="任务完成" value={formatNullablePercent(snapshot.metrics.taskCompletionRate)} valueSize="base" /></Card>
              <Card variant="subtle" className="p-3.5"><Metric label="低转化" value={formatCount(snapshot.metrics.lowConversionCount)} valueSize="base" /></Card>
            </>
          ) : (
            <>
              <Card variant="subtle" className="p-3.5"><Metric label="有效学习" value={formatNullableMinutes(snapshot.metrics.effectiveMinutes)} valueSize="base" /></Card>
              <Card variant="subtle" className="p-3.5"><Metric label="任务完成" value={formatNullablePercent(snapshot.metrics.taskCompletionRate)} valueSize="base" /></Card>
              <Card variant="subtle" className="p-3.5"><Metric label="复盘完成" value={formatNullablePercent(snapshot.metrics.reviewCompletionRate)} valueSize="base" /></Card>
              <Card variant="subtle" className="p-3.5"><Metric label="欠账" value={formatCount(snapshot.metrics.debtCount)} valueSize="base" /></Card>
            </>
          )}
        </div>
      </Card>

      {snapshot.weakness ? (
        <Card variant="master" className="p-6 space-y-4">
          <SectionHeader title="当时的最大短板" meta={<Badge tone="warning">规则判断</Badge>} />
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-white">{snapshot.weakness.title}</h2>
            <p className="text-sm leading-relaxed text-zinc-300">{snapshot.weakness.detail}</p>
            <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-zinc-400">
              {snapshot.weakness.reasons.map((reason) => <li key={reason} className="flex gap-2"><span>•</span><span>{reason}</span></li>)}
            </ul>
          </div>
        </Card>
      ) : null}

      <Card variant="master" className="p-6 space-y-4">
        <SectionHeader title="当时的决策" meta={<Badge tone={decision.status === "confirmed" ? "success" : "neutral"}>{decision.status === "confirmed" ? "已确认" : "已驳回"}</Badge>} />
        {decision.status === "confirmed" ? (
          <div className="space-y-3 text-sm leading-relaxed">
            <p className="font-semibold text-white">下周期焦点：{nextCycleFocus ?? snapshot.mustPressIssue ?? "未记录"}</p>
            <p className="text-xs text-zinc-300">阶段建议：{snapshot.stageAdjustment ?? "早期记录未保存完整阶段建议。"}</p>
            <p className="text-xs text-zinc-500">该次确认只生成草稿；没有自动修改阶段计划或现有任务。</p>
          </div>
        ) : <p className="text-sm text-zinc-400">该次报告被驳回，没有创建阶段草稿，也没有写入下一周期行动。</p>}
      </Card>

      <Card variant="master" className="p-6 space-y-4">
        <SectionHeader title="当时的生成结果" description="这里只保留汇总数量，不能据此推断每条草稿当前是否已转成任务。" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card variant="subtle" className="p-3.5"><Metric label="新增草稿" value={`${decision.inboxResult.createdCount} 项`} valueSize="base" /></Card>
          <Card variant="subtle" className="p-3.5"><Metric label="复用" value={`${decision.inboxResult.reusedCount} 项`} valueSize="base" /></Card>
          <Card variant="subtle" className="p-3.5"><Metric label="被替代" value={`${decision.inboxResult.supersededCount} 项`} valueSize="base" /></Card>
        </div>
        <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
          {decision.inboxResult.createdCount + decision.inboxResult.reusedCount > 0 ? (
            <ButtonLink href={withReturnTo("/roadmap/allocation/drafts", historyHref)} variant="secondary" size="sm">
              <ClipboardList size={14} aria-hidden="true" />查看当前收件箱
            </ButtonLink>
          ) : null}
          {decision.stageDraftId ? (
            <ButtonLink href="/roadmap/stages" variant="secondary" size="sm">
              <Milestone size={14} aria-hidden="true" />查看当前阶段
            </ButtonLink>
          ) : null}
        </div>
      </Card>
    </PageFrame>
  );
}

function formatNullableMinutes(value: number | null) { return value === null ? "未记录" : formatMinutesValue(value); }
function formatCount(value: number | null) { return value === null ? "未记录" : `${value} 项`; }
function formatNullablePercent(value: number | null) { return value === null ? "未记录" : formatPercentValue(value); }

