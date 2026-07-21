import Link from "next/link";
import { redirect } from "next/navigation";
import { StageDraftActions } from "@/components/stage-draft-actions";
import { getCurrentUser } from "@/lib/auth/session";
import { listStageAdjustmentDrafts, listStagePlans } from "@/lib/study/stage-service";

export const dynamic = "force-dynamic";

export default async function StageOverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [plans, drafts] = await Promise.all([listStagePlans(user.id), listStageAdjustmentDrafts(user.id)]);
  const plan = plans.find((item) => item.status === "active") ?? plans[0];
  const draft = drafts.find((item) => item.status === "draft");

  return (
    <section className="space-y-5">
      <div><p className="text-sm text-teal-300">阶段</p><h1 className="text-2xl font-semibold text-white">阶段概览</h1><p className="mt-1 text-sm text-zinc-400">当前阶段、下一里程碑与待确认调整。</p></div>
      <div className="rounded-md border border-white/10 bg-[#101419] p-4">
        {plan ? <><p className="text-lg text-white">{plan.name}</p><p className="mt-2 text-sm text-zinc-400">{plan.goal}</p><p className="mt-2 text-xs text-zinc-500">{new Date(plan.startDate).toLocaleDateString("zh-CN")} - {new Date(plan.endDate).toLocaleDateString("zh-CN")}</p></> : <p className="text-sm text-zinc-500">尚无阶段计划。</p>}
      </div>
      {draft ? <div className="rounded-md border border-amber-400/20 bg-amber-500/5 p-4"><p className="text-sm text-amber-100">待确认草稿：{draft.riskConclusion}</p><p className="mt-2 text-xs text-amber-200/70">确认只更新 StagePlan 并原子入箱，不自动修改任务。</p><StageDraftActions draftId={draft.id}/></div> : null}
      <div className="grid gap-3 sm:grid-cols-3"><Link href="/stage/simulation" className="rounded-md border border-white/10 p-4 text-sm text-teal-300">模拟与失分 →</Link><Link href="/stage/analytics?window=7" className="rounded-md border border-white/10 p-4 text-sm text-teal-300">7/30 天趋势 →</Link><Link href="/review/reports" className="rounded-md border border-white/10 p-4 text-sm text-teal-300">周期报告 →</Link></div>
    </section>
  );
}
