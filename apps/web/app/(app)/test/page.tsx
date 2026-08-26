import { ArrowRight, ClipboardCheck, FileCheck2, Plus, Zap } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { listKnowledgeRetests } from "@/lib/study/knowledge-retest-service";
import { listSimulationExams } from "@/lib/study/simulation-service";
import { TestCommandDeck } from "@/components/test/test-command-deck";
import {
  buildPendingTestQueue,
  calculateLossReasonDistribution,
  calculateMockExamTrends,
  calculateTestKpis,
  calculateWeakModuleLossRankings,
} from "@/components/test/test-support";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/test");

export default async function TestPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [retests, simulations] = await Promise.all([
    listKnowledgeRetests(user.id),
    listSimulationExams(user.id),
  ]);

  const openRetests = retests.filter(
    (item) => item.status !== "CLOSED" && item.status !== "VOIDED",
  ).length;
  const unfinishedSimulations = simulations.filter(
    (item) => item.status === "DRAFT" || item.status === "IN_PROGRESS",
  ).length;

  const kpis = calculateTestKpis(retests, simulations);
  const trend = calculateMockExamTrends(simulations);
  const distribution = calculateLossReasonDistribution(simulations);
  const rankings = calculateWeakModuleLossRankings(simulations, 5);
  const queue = buildPendingTestQueue(retests, simulations);

  return (
    <PageFrame variant="dashboard-wide">
      <PageHeader
        eyebrow="检验"
        title="检验中心"
        description="专项复测判断知识点是否稳定掌握，模拟考试判断整体结果；两条证据分别记录，不互相替代。"
        action={
          <div className="flex items-center gap-2">
            <ButtonLink href="/test/retests/new" variant="primary">
              <Zap size={15} aria-hidden="true" />
              <span>安排专项复测</span>
            </ButtonLink>
            <ButtonLink href="/test/simulations#create-simulation" variant="secondary">
              <Plus size={15} aria-hidden="true" />
              <span>创建模拟考试</span>
            </ButtonLink>
          </div>
        }
      />

      {/* Bloomberg-Style Exam Command Deck */}
      <TestCommandDeck
        kpis={kpis}
        trend={trend}
        rankings={rankings}
        distribution={distribution}
        queue={queue}
        openRetestsCount={openRetests}
        unfinishedSimulationsCount={unfinishedSimulations}
      />

      {/* Gateway Tiles to Specialized Sub-modules */}
      <section className="space-y-3 pt-2">
        <SectionHeader
          title="检验模块入口"
          description="专项复测与模拟考试双引擎分工协作，形成闭环备考证据链。"
        />
        <div className="af-content-grid-two grid gap-4 border-b border-white/10 pb-7">
          <TestEntry
            href="/test/retests"
            title="专项复测"
            description="按知识点复测，记录结果、反馈和下一次复测时间。"
            count={openRetests}
            countLabel="待处理"
            icon={<ClipboardCheck size={20} aria-hidden="true" />}
          />
          <TestEntry
            href="/test/simulations"
            title="模拟考试"
            description="完成评分、失分分析、个人反馈和复盘后，才形成已确认记录。"
            count={unfinishedSimulations}
            countLabel="未收口"
            icon={<FileCheck2 size={20} aria-hidden="true" />}
          />
        </div>
      </section>

      {/* Rules Card */}
      <section className="space-y-3">
        <SectionHeader title="检验规则" description="检验是证据，不是一次性的状态标签。" />
        <Card variant="subtle" className="p-4 sm:p-5 bg-[#0e1619]/90 border border-white/10">
          <ul className="divide-y divide-white/5 text-sm leading-6 text-zinc-300">
            <li className="py-2.5 first:pt-0 last:pb-0">
              复测结果会更新知识点的掌握状态，并安排下一次复测。
            </li>
            <li className="py-2.5 first:pt-0 last:pb-0">
              模拟考试必须完成评分、失分、反馈和复盘，再进入确认中心。
            </li>
            <li className="py-2.5 first:pt-0 last:pb-0">
              任何建议都先进入确认边界，不直接改写计划或阶段。
            </li>
          </ul>
        </Card>
      </section>
    </PageFrame>
  );
}

function TestEntry(props: {
  href: string;
  title: string;
  description: string;
  count: number;
  countLabel: string;
  icon: React.ReactNode;
}) {
  return (
    <Link href={props.href} className="group block">
      <Card
        variant="master"
        className="flex min-h-36 flex-col justify-between p-4 sm:p-5 transition-all hover:border-teal-400/40 hover:shadow-[0_0_20px_rgba(45,212,191,0.15)] bg-[#0e1619]/90 border border-white/10"
      >
        <div className="flex items-start justify-between gap-4">
          <span className="text-teal-300">{props.icon}</span>
          <Badge tone={props.count > 0 ? "warning" : "neutral"} className="font-mono">
            {props.count} {props.countLabel}
          </Badge>
        </div>
        <div className="mt-5 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-lg font-medium text-white group-hover:text-teal-200">{props.title}</h3>
            <p className="mt-1 text-sm leading-6 text-zinc-400">{props.description}</p>
          </div>
          <ArrowRight
            className="mb-1 shrink-0 text-zinc-500 transition-colors group-hover:text-teal-300 group-hover:translate-x-0.5"
            size={18}
            aria-hidden="true"
          />
        </div>
      </Card>
    </Link>
  );
}
