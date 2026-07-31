import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, ClipboardList, FileChartColumn } from "lucide-react";
import { StageDraftActions, StageDraftCreateAction } from "@/components/stage-draft-actions";
import { StagePlanCreateForm } from "@/components/stage-plan-create-form";
import { StageMilestoneManager } from "@/components/stage-milestone-manager";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { listPlanMilestones } from "@/lib/study/plan-milestone-service";
import {
  getLatestStageAdjustmentDecisionResult,
  listStageAdjustmentDrafts,
  listStagePlans,
  type StageAdjustmentDecisionReplay,
} from "@/lib/study/stage-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/stage/overview");

export default async function StageOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ createMilestone?: string; returnTo?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const [plans, drafts, milestones, latestDecision] = await Promise.all([
    listStagePlans(user.id),
    listStageAdjustmentDrafts(user.id),
    listPlanMilestones(user.id),
    getLatestStageAdjustmentDecisionResult(user.id),
  ]);
  const plan = plans.find((item) => item.status === "active") ?? plans[0];
  const draft = drafts.find((item) => item.status === "draft");
  const latestRejectedDraft = drafts.find((item) => item.status === "rejected");

  return (
    <section className="space-y-6">
      <header className="border-b border-white/10 pb-4">
        <h1 className="text-xl font-semibold text-white">阶段</h1>
        <p className="mt-1 text-sm text-zinc-500">目标、里程碑和待确认调整</p>
      </header>

      {plan ? (
        <section aria-labelledby="current-stage-heading">
          <p className="text-xs text-zinc-500">当前阶段</p>
          <h2 id="current-stage-heading" className="mt-1 text-lg font-medium text-white">{plan.name}</h2>
          <p className="mt-2 text-sm text-zinc-400">{plan.goal}</p>
          <p className="mt-2 text-xs text-zinc-500">{formatDate(plan.startDate)} 至 {formatDate(plan.endDate)}</p>
        </section>
      ) : (
        <section className="space-y-4">
          <p className="text-sm text-zinc-400">先建立当前阶段，再把目标拆成里程碑。</p>
          <StagePlanCreateForm />
        </section>
      )}

      {plan ? (
        <StageMilestoneManager
          plan={plan}
          milestones={milestones.filter((milestone) => milestone.stagePlanId === plan.id)}
          initialStableKey={query.createMilestone}
          returnTo={safeReturnTo(query.returnTo)}
        />
      ) : null}

      {draft ? (
        <section className="rounded-md border border-amber-400/30 bg-amber-500/5 p-4" aria-labelledby="pending-stage-draft">
          <p id="pending-stage-draft" className="text-xs font-medium text-amber-200">待确认调整</p>
          <p className="mt-2 text-sm leading-6 text-zinc-200">{draft.riskConclusion}</p>
          <p className="mt-2 text-xs text-zinc-500">确认会更新当前阶段，并将任务调整写入计划收件箱；不会直接修改现有任务。</p>
          <details className="mt-2 text-xs text-zinc-600">
            <summary className="cursor-pointer">查看来源</summary>
            <p className="mt-1 break-all">{draft.sourceReportDecisionId ? `周期报告 ${draft.sourceReportDecisionId.slice(0, 8)}` : "当前工作区规则"}</p>
          </details>
          <StageDraftActions draft={draft} />
        </section>
      ) : null}

      {!draft && plan ? (
        <section className="border-l-2 border-white/10 pl-4">
          <p className="text-sm text-zinc-200">{latestRejectedDraft ? "上一版调整已拒绝" : "当前没有待确认调整"}</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            {latestRejectedDraft ? "重新评估会生成一个独立新版本。" : "可根据执行、复盘与模拟数据生成建议。"}
          </p>
          <div className="mt-3"><StageDraftCreateAction stagePlanId={plan.id} label={latestRejectedDraft ? "重新评估" : "生成调整建议"} /></div>
        </section>
      ) : null}

      {latestDecision ? <LatestStageDecision result={latestDecision} /> : null}

      <nav className="grid divide-y divide-white/10 border-y border-white/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0" aria-label="阶段相关入口">
        <StageLink href="/stage/simulation" label="模拟与失分" icon={<ClipboardList size={17} aria-hidden="true" />} />
        <StageLink href="/stage/analytics?window=7" label="学习趋势" icon={<BarChart3 size={17} aria-hidden="true" />} />
        <StageLink href="/review/reports" label="周期报告" icon={<FileChartColumn size={17} aria-hidden="true" />} />
      </nav>
    </section>
  );
}

function LatestStageDecision({ result }: { result: StageAdjustmentDecisionReplay }) {
  const inbox = result.inboxResult;
  return (
    <section aria-labelledby="latest-stage-decision" className="border-t border-white/10 pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="latest-stage-decision" className="text-sm font-medium text-zinc-100">最近处理结果</h2>
          <p className="mt-1 text-xs text-zinc-500">{result.decidedAt ? new Date(result.decidedAt).toLocaleString("zh-CN", { hour12: false }) : "未记录处理时间"}</p>
        </div>
        <span className={result.status === "applied" ? "text-sm text-teal-300" : "text-sm text-zinc-400"}>{result.status === "applied" ? "已应用" : "已拒绝"}</span>
      </div>
      {inbox ? <p className="mt-3 text-sm text-zinc-400">新增 {inbox.createdCount} 条计划草稿，复用 {inbox.reusedCount} 条。</p> : null}
      <p className="mt-2 text-xs leading-5 text-zinc-500">{result.draft.riskConclusion}</p>
      <Link href="/today/inbox" className="mt-2 inline-flex text-sm text-teal-300">查看计划收件箱</Link>
    </section>
  );
}

function StageLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return <Link href={href} className="flex items-center gap-2 px-3 py-3 text-sm text-zinc-300 hover:bg-white/5 hover:text-white">{icon}{label}</Link>;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function safeReturnTo(value?: string): string | undefined {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;
  return value;
}
