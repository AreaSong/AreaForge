import Link from "next/link";
import { redirect } from "next/navigation";
import { StageDraftActions, StageDraftCreateAction } from "@/components/stage-draft-actions";
import { StagePlanCreateForm } from "@/components/stage-plan-create-form";
import { StageMilestoneManager } from "@/components/stage-milestone-manager";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import {
  getLatestStageAdjustmentDecisionResult,
  listStageAdjustmentDrafts,
  listStagePlans,
  type StageAdjustmentDecisionReplay,
} from "@/lib/study/stage-service";
import { listPlanMilestones } from "@/lib/study/plan-milestone-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/stage/overview");

export default async function StageOverviewPage({ searchParams }: { searchParams: Promise<{ createMilestone?: string; returnTo?: string }> }) {
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
    <section className="space-y-5">
      <div><p className="text-sm text-teal-300">阶段</p><h1 className="text-2xl font-semibold text-white">阶段概览</h1><p className="mt-1 text-sm text-zinc-400">当前阶段、下一里程碑与待确认调整。</p></div>
      <div className="rounded-md border border-white/10 bg-[#101419] p-4">
        {plan ? <><p className="text-lg text-white">{plan.name}</p><p className="mt-2 text-sm text-zinc-400">{plan.goal}</p><p className="mt-2 text-xs text-zinc-500">{new Date(plan.startDate).toLocaleDateString("zh-CN")} - {new Date(plan.endDate).toLocaleDateString("zh-CN")}</p></> : <><p className="mb-4 text-sm text-zinc-400">先建立当前阶段，再生成需确认的调整草稿。</p><StagePlanCreateForm/></>}
      </div>
      {plan ? <StageMilestoneManager plan={plan} milestones={milestones.filter((milestone) => milestone.stagePlanId === plan.id)} initialStableKey={query.createMilestone} returnTo={safeReturnTo(query.returnTo)} /> : null}
      {draft ? <div className="rounded-md border border-amber-400/20 bg-amber-500/5 p-4"><p className="text-sm text-amber-100">待确认草稿：{draft.riskConclusion}</p><p className="mt-2 text-xs text-amber-200/70">确认只更新 StagePlan 并原子入箱，不自动修改任务。</p>{draft.sourceReportDecisionId ? <p className="mt-2 text-xs text-zinc-500">来源：周期报告 {draft.sourceReportDecisionId.slice(0, 8)} · report rev {draft.sourceReportRevision ?? "?"} · stage version {draft.originVersion ?? draft.revision}</p> : <p className="mt-2 text-xs text-zinc-500">来源：当前工作区本地规则 · stage rev {draft.revision}</p>}<StageDraftActions draft={draft}/></div> : null}
      {!draft && plan ? (
        <div className="rounded-md border border-white/10 bg-[#101419] p-4">
          <p className="text-sm text-zinc-100">{latestRejectedDraft ? "上一版阶段草稿已拒绝" : "暂无待确认阶段草稿"}</p>
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            {latestRejectedDraft
              ? "旧版本保持终态；重新评估会基于当前数据创建独立新版本。"
              : "基于当前执行、复盘与模拟数据生成一个需单独确认的版本。"}
          </p>
          <div className="mt-3"><StageDraftCreateAction stagePlanId={plan.id} label={latestRejectedDraft ? "生成新版本" : "生成阶段草稿"}/></div>
        </div>
      ) : null}
      {latestDecision ? <LatestStageDecision result={latestDecision} /> : null}
      <div className="grid gap-3 sm:grid-cols-3"><Link href="/stage/simulation" className="rounded-md border border-white/10 p-4 text-sm text-teal-300">模拟与失分 →</Link><Link href="/stage/analytics?window=7" className="rounded-md border border-white/10 p-4 text-sm text-teal-300">7/30 天趋势 →</Link><Link href="/review/reports" className="rounded-md border border-white/10 p-4 text-sm text-teal-300">周期报告 →</Link></div>
    </section>
  );
}

function LatestStageDecision({ result }: { result: StageAdjustmentDecisionReplay }) {
  const inbox = result.inboxResult;
  return (
    <section aria-labelledby="latest-stage-decision" className="rounded-md border border-white/10 bg-[#101419] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p id="latest-stage-decision" className="text-sm font-medium text-zinc-100">最近处理结果</p>
          <p className="mt-1 text-xs text-zinc-500">
            {result.decidedAt ? new Date(result.decidedAt).toLocaleString("zh-CN", { hour12: false }) : "历史版本未记录处理时间"}
          </p>
        </div>
        <span className={result.status === "applied" ? "text-sm text-teal-300" : "text-sm text-zinc-400"}>
          {result.status === "applied" ? "已应用" : "已拒绝"}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
        <DecisionMetric label="终态 revision" value={String(result.draft.revision)} />
        <DecisionMetric label="入箱新增" value={inbox ? String(inbox.createdCount) : "历史版本未记录"} />
        <DecisionMetric label="复用" value={inbox ? String(inbox.reusedCount) : "历史版本未记录"} />
        <DecisionMetric label="替代" value={inbox ? String(inbox.supersededCount) : "历史版本未记录"} />
      </dl>
      <p className="mt-3 text-xs leading-5 text-zinc-500">{result.draft.riskConclusion}</p>
      <Link href="/today/inbox" className="mt-3 inline-flex h-10 items-center text-sm text-teal-300">查看收件箱</Link>
    </section>
  );
}

function DecisionMetric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-zinc-500">{label}</dt><dd className="mt-1 break-words text-zinc-200">{value}</dd></div>;
}

function safeReturnTo(value?: string): string | undefined {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;
  return value;
}
