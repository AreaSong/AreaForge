import { ArrowRight, ClipboardCheck, FileCheck2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/feedback";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { listKnowledgeRetests } from "@/lib/study/knowledge-retest-service";
import { listSimulationExams } from "@/lib/study/simulation-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/test");

export default async function TestPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [retests, simulations] = await Promise.all([
    listKnowledgeRetests(user.id),
    listSimulationExams(user.id),
  ]);
  const openRetests = retests.filter((item) => item.status !== "CLOSED" && item.status !== "VOIDED").length;
  const unfinishedSimulations = simulations.filter((item) => item.status === "DRAFT").length;

  return (
    <PageFrame variant="dashboard-wide">
      <PageHeader
        eyebrow="检验"
        title="检验中心"
        description="专项复测判断知识点是否稳定掌握，模拟考试判断整体结果；两条证据分别记录，不互相替代。"
      />
      <section className="af-content-grid-two grid gap-4 border-b border-white/10 pb-7">
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
      </section>
      <section className="space-y-3">
        <SectionHeader title="检验规则" description="检验是证据，不是一次性的状态标签。" />
        <ul className="divide-y divide-white/10 border-y border-white/10 text-sm leading-6 text-zinc-400">
          <li className="py-3">复测结果会更新知识点的掌握状态，并安排下一次复测。</li>
          <li className="py-3">模拟考试必须完成评分、失分、反馈和复盘，再进入确认中心。</li>
          <li className="py-3">任何建议都先进入确认边界，不直接改写计划或阶段。</li>
        </ul>
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
    <Link href={props.href} className="group flex min-h-36 flex-col justify-between border border-white/10 bg-white/[0.02] p-5 transition-colors hover:border-teal-300/40 hover:bg-teal-400/[0.04]">
      <div className="flex items-start justify-between gap-4">
        <span className="text-teal-300">{props.icon}</span>
        <Badge tone={props.count > 0 ? "warning" : "neutral"}>{props.count} {props.countLabel}</Badge>
      </div>
      <div className="mt-6 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-medium text-white group-hover:text-teal-200">{props.title}</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-400">{props.description}</p>
        </div>
        <ArrowRight className="mb-1 shrink-0 text-zinc-500 group-hover:text-teal-300" size={18} aria-hidden="true" />
      </div>
    </Link>
  );
}
