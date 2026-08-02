import { ArrowRight, BarChart3, CalendarClock, ClipboardList, FileChartColumn, Flag, Target } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StageDraftActions, StageDraftCreateAction } from "@/components/stage-draft-actions";
import { StagePlanCreateForm } from "@/components/stage-plan-create-form";
import { StageMilestoneManager } from "@/components/stage-milestone-manager";
import { ButtonLink } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, withReturnTo } from "@/lib/navigation/batch7";
import { listPlanMilestones } from "@/lib/study/plan-milestone-service";
import {
  getLatestStageAdjustmentDecisionResult,
  listStageAdjustmentDrafts,
  listStagePlans,
  type StageAdjustmentDecisionReplay,
} from "@/lib/study/stage-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/plan/stages");

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
  const planMilestones = plan ? milestones.filter((item) => item.stagePlanId === plan.id) : [];
  const activeMilestones = planMilestones.filter((item) => !item.archivedAt);
  const nextAction = draft
    ? { label: "审阅阶段调整", href: "#pending-stage-draft", detail: "报告或模拟已生成待确认建议，先决定是否应用到当前阶段。" }
    : !plan
      ? { label: "创建当前阶段", href: "#create-stage-plan", detail: "先建立目标和日期，后续报告才有明确的阶段落点。" }
      : activeMilestones.length > 0
        ? { label: "检查最近里程碑", href: "#stage-milestones-heading", detail: "当前没有待确认建议，继续沿生效计划推进最近的检查点。" }
        : { label: "查看周期趋势", href: "/plan/stages/analytics?window=7", detail: "当前没有待确认建议或进行中里程碑，先用趋势判断是否需要调整。" };

  return (
    <PageFrame variant="dashboard-wide">
      <PageHeader
        eyebrow="阶段"
        title="阶段概览"
        description="区分当前生效计划、待确认建议和已经处理的结果，持续跟踪下一周期。"
        status={plan ? <Badge tone={plan.status === "active" ? "success" : "neutral"}>{plan.status === "active" ? "当前计划生效中" : "历史阶段"}</Badge> : <Badge tone="warning">尚未建立阶段</Badge>}
      />

      <section className="grid gap-6 border-b border-white/10 pb-7 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)] lg:items-center">
        <div className="min-w-0">
          <p className="text-xs font-medium text-teal-300">当前唯一下一行动</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{nextAction.label}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{nextAction.detail}</p>
        </div>
        <ButtonLink href={nextAction.href} variant="primary" size="lg" className="w-full lg:w-auto">{nextAction.label}<ArrowRight size={16} aria-hidden="true" /></ButtonLink>
      </section>

      {plan ? (
        <section className="space-y-4">
          <SectionHeader title="当前生效计划" description="这是阶段源事实；待确认建议只有在你确认后才会更新这里。" />
          <div className="grid gap-6 border-y border-white/10 py-5 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(8rem,0.4fr))] lg:items-start">
            <div className="min-w-0">
              <p className="text-lg font-medium text-white">{plan.name}</p>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{plan.goal}</p>
            </div>
            <StageMetric icon={<CalendarClock size={16} aria-hidden="true" />} label="剩余时间" value={remainingDays(plan.endDate)} />
            <StageMetric icon={<Flag size={16} aria-hidden="true" />} label="进行中里程碑" value={`${activeMilestones.length} 项`} />
            <StageMetric icon={<Target size={16} aria-hidden="true" />} label="阶段周期" value={`${formatDate(plan.startDate)} - ${formatDate(plan.endDate)}`} compact />
          </div>
        </section>
      ) : (
        <section id="create-stage-plan" className="space-y-4 scroll-mt-24">
          <SectionHeader title="创建当前阶段" description="建立目标、日期和模式后，再把阶段拆成里程碑。" />
          <StagePlanCreateForm />
        </section>
      )}

      {draft ? (
        <section id="pending-stage-draft" className="scroll-mt-24 space-y-5 border-y border-amber-400/25 bg-amber-500/[0.04] px-4 py-5 sm:px-5" aria-labelledby="pending-stage-draft-heading">
          <SectionHeader title="待确认阶段建议" description="这是待确认草稿，不是当前生效计划。" meta={<Badge tone="warning">需要你的决定</Badge>} />
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(16rem,0.75fr)]">
            <div>
              <h2 id="pending-stage-draft-heading" className="text-base font-medium leading-7 text-zinc-100">{draft.riskConclusion}</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-400">下一阶段重点：{draft.nextStageEmphasis}</p>
              {draft.focusSubjects.length ? <p className="mt-2 text-sm text-zinc-500">重点科目：{draft.focusSubjects.join("、")}</p> : null}
            </div>
            <div className="border-t border-white/10 pt-4 text-xs leading-5 text-zinc-500 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
              <p>确认后更新当前阶段，并把任务调整写入计划收件箱。</p>
              <p className="mt-2">现有任务不会被直接修改，入箱草稿仍需逐项转为正式任务。</p>
              <p className="mt-2">来源：{draft.sourceReportDecisionId ? `周期报告 ${draft.sourceReportDecisionId.slice(0, 8)}` : "当前工作区规则"}</p>
            </div>
          </div>
          <StageDraftActions draft={draft} />
        </section>
      ) : null}

      {!draft && plan ? (
        <Alert tone={latestRejectedDraft ? "neutral" : "info"} title={latestRejectedDraft ? "上一版建议已拒绝" : "当前没有待确认建议"} action={<StageDraftCreateAction stagePlanId={plan.id} label={latestRejectedDraft ? "重新评估" : "生成调整建议"} />}>
          {latestRejectedDraft ? "重新评估会生成独立的新版本，不会恢复上一版。" : "需要重新评估时，可根据当前执行、复盘与模拟数据生成一份本地规则草稿。"}
        </Alert>
      ) : null}

      {plan ? (
        <StageMilestoneManager
          plan={plan}
          milestones={planMilestones}
          initialStableKey={query.createMilestone}
          returnTo={safeReturnTo(query.returnTo)}
        />
      ) : null}

      {latestDecision ? <LatestStageDecision result={latestDecision} returnTo={stageOverviewHref(query)} /> : null}

      <section className="space-y-4">
        <SectionHeader title="继续判断阶段状态" description="趋势和报告提供证据，模拟考试提供结构化失分；它们不会自动改写当前计划。" />
        <nav className="grid divide-y divide-white/10 border-y border-white/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0" aria-label="阶段相关入口">
          <StageLink href="/test/simulations" label="模拟与失分" icon={<ClipboardList size={17} aria-hidden="true" />} />
          <StageLink href="/plan/stages/analytics?window=7" label="学习趋势" icon={<BarChart3 size={17} aria-hidden="true" />} />
          <StageLink href="/review/reports" label="周期报告" icon={<FileChartColumn size={17} aria-hidden="true" />} />
        </nav>
      </section>
    </PageFrame>
  );
}

function LatestStageDecision({ result, returnTo }: { result: StageAdjustmentDecisionReplay; returnTo: string }) {
  const inbox = result.inboxResult;
  return (
    <section className="space-y-4 border-b border-white/10 pb-6" aria-labelledby="latest-stage-decision">
      <SectionHeader title="最近阶段处理结果" description="这是最近一次已结束决策，不是待确认建议。" meta={<Badge tone={result.status === "applied" ? "success" : "neutral"}>{result.status === "applied" ? "已应用" : "已拒绝"}</Badge>} />
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <p id="latest-stage-decision" className="text-sm leading-6 text-zinc-300">{result.draft.riskConclusion}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {result.decidedAt ? new Date(result.decidedAt).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }) : "未记录处理时间"}
            {inbox ? ` · 入箱新增 ${inbox.createdCount}，复用 ${inbox.reusedCount}` : ""}
          </p>
        </div>
        {result.status === "applied" && inbox && inbox.createdCount > 0 ? <ButtonLink href={withReturnTo("/plan/inbox", returnTo)} variant="primary"><ClipboardList size={15} aria-hidden="true" />处理入箱草稿</ButtonLink> : null}
        {result.status === "applied" && inbox && inbox.createdCount === 0 && inbox.reusedCount > 0 ? <ButtonLink href={withReturnTo("/plan/inbox", returnTo)} variant="secondary"><ClipboardList size={15} aria-hidden="true" />查看计划收件箱</ButtonLink> : null}
      </div>
    </section>
  );
}

function StageMetric({ icon, label, value, compact = false }: { icon: React.ReactNode; label: string; value: string; compact?: boolean }) {
  return <div className="border-l border-white/10 pl-3"><p className="flex items-center gap-2 text-xs text-zinc-500">{icon}{label}</p><p className={`mt-2 font-medium text-zinc-100 ${compact ? "text-sm leading-6" : "text-xl"}`}>{value}</p></div>;
}
function StageLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) { return <Link href={href} className="flex items-center justify-between gap-3 px-4 py-4 text-sm text-zinc-300 hover:bg-white/5 hover:text-white"><span className="flex items-center gap-2">{icon}{label}</span><ArrowRight size={15} aria-hidden="true" /></Link>; }
function remainingDays(endDate: string) { const days = Math.ceil((new Date(endDate).getTime() - Date.now()) / 86_400_000); return days > 0 ? `${days} 天` : days === 0 ? "今天结束" : "已结束"; }
function formatDate(value: string) { return new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }); }
function safeReturnTo(value?: string) { if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined; return value; }
function stageOverviewHref(query: { createMilestone?: string; returnTo?: string }): string {
  const params = new URLSearchParams();
  if (query.createMilestone) params.set("createMilestone", query.createMilestone);
  const nestedReturnTo = safeReturnTo(query.returnTo);
  if (nestedReturnTo) params.set("returnTo", nestedReturnTo);
  const search = params.toString();
  return `/plan/stages${search ? `?${search}` : ""}`;
}
