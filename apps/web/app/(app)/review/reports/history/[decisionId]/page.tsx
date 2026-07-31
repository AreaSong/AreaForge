import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DetailHeading } from "@/components/detail-heading";
import { BackToListLink } from "@/components/list-return-context";
import { getCurrentUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/responses";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { getPeriodicReportDecision } from "@/lib/study/report-decisions-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/review/reports/history/decision");

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
  const decision = await getPeriodicReportDecision(decisionId, user.id).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  const snapshot = decision.reportSnapshot;

  return (
    <section className="space-y-5">
      <BackToListLink
        fallbackHref={`/review/reports?tab=history&period=${query.period === "month" ? "month" : "week"}`}
        className="text-sm text-teal-300"
      >
        返回报告历史
      </BackToListLink>

      <div>
        <p className="text-sm text-teal-300">{decision.kind === "month" ? "月复盘" : "周审判"}</p>
        <DetailHeading className="text-2xl font-semibold text-white">冻结报告</DetailHeading>
        <p className="mt-1 text-sm text-zinc-400">
          {formatDateRange(decision.range.start, decision.range.end)} · {new Date(decision.decidedAt).toLocaleString("zh-CN")}
        </p>
      </div>

      <section className="rounded-md border border-white/10 bg-[#101419] p-4" aria-labelledby="snapshot-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="snapshot-heading" className="font-medium text-white">1. 冻结快照</h2>
          <span className={decision.status === "confirmed" ? "text-sm text-teal-200" : "text-sm text-zinc-400"}>
            {decision.status === "confirmed" ? "已确认" : "已拒绝"}
          </span>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="有效学习" value={`${snapshot.metrics.effectiveMinutes} 分钟`} />
          <Metric label="任务完成率" value={formatPercent(snapshot.metrics.taskCompletionRate)} />
          <Metric label="复盘完成率" value={formatPercent(snapshot.metrics.reviewCompletionRate)} />
          <Metric label="欠账" value={`${snapshot.metrics.debtCount} 项`} />
        </dl>
        <div className="mt-4 border-t border-white/10 pt-4">
          <p className="text-sm font-medium text-white">{snapshot.weakness.title}</p>
          <p className="mt-1 text-sm text-zinc-300">{snapshot.weakness.detail}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-400">
            {snapshot.weakness.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
      </section>

      <section className="rounded-md border border-white/10 bg-[#101419] p-4" aria-labelledby="impact-heading">
        <h2 id="impact-heading" className="font-medium text-white">2. 影响</h2>
        {decision.status === "confirmed" ? (
          <div className="mt-3 space-y-3 text-sm">
            <p className="text-zinc-300">{snapshot.strategy.mustPressIssue}</p>
            <p className="text-zinc-400">阶段建议：{snapshot.nextCycleDraft.stageAdjustment}</p>
            <p className="text-zinc-400">
              阶段草稿：{decision.stageDraftId ? "已创建，仍需单独确认" : "未创建"}；没有自动改写阶段计划或任务。
            </p>
            {decision.stageDraftId ? <Link href="/stage/overview" className="inline-block text-teal-300">查看阶段建议</Link> : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-zinc-400">本次报告被拒绝，没有创建阶段草稿，也没有写入下一周期行动。</p>
        )}
      </section>

      <section className="rounded-md border border-white/10 bg-[#101419] p-4" aria-labelledby="inbox-heading">
        <h2 id="inbox-heading" className="font-medium text-white">3. 入箱结果</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <Metric label="当前行动" value={`${decision.inboxResult.createdCount} 项`} />
          <Metric label="复用" value={`${decision.inboxResult.reusedCount} 项`} />
          <Metric label="已被替代" value={`${decision.inboxResult.supersededCount} 项`} />
        </dl>
        {decision.inboxResult.createdCount > 0 ? (
          <Link href="/today/inbox" className="mt-4 inline-block text-sm text-teal-300">查看行动收件箱</Link>
        ) : (
          <p className="mt-4 text-sm text-zinc-500">没有当前可执行的入箱行动。</p>
        )}
      </section>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-zinc-200">{value}</dd>
    </div>
  );
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDateRange(start: string, end: string): string {
  return `${new Date(start).toLocaleDateString("zh-CN")} 至 ${new Date(end).toLocaleDateString("zh-CN")}`;
}
