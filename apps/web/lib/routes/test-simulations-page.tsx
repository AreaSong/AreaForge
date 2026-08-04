import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SimulationListClient } from "@/components/simulation-list-client";
import { ButtonLink } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { listSimulationExams } from "@/lib/study/simulation-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/test/simulations");

export default async function TestSimulationPage() {
  const user = await getCurrentUser(); if (!user) redirect("/login");
  const exams = await listSimulationExams(user.id);
  const drafts = exams.filter((exam) => exam.status === "DRAFT");
  const history = exams.filter((exam) => exam.status === "CONFIRMED");
  const latestDraft = drafts[0];

  return (
    <PageFrame variant="dashboard-wide">
      <PageHeader
        eyebrow="检验"
        title="模拟考试"
        description="录入考试事实，冻结失分分析，再把明确的补救动作送入投入草稿。"
        action={latestDraft
          ? <ButtonLink href={`/test/simulations/${latestDraft.id}`} variant="primary"><ArrowRight size={16} />继续未完成模拟</ButtonLink>
          : <ButtonLink href="#create-simulation" variant="primary"><Plus size={16} />创建新模拟</ButtonLink>}
      />

      {latestDraft ? (
        <section className="space-y-3">
          <SectionHeader title="继续分析" description="优先完成当前考试的录分、失分核对与事实确认。" meta={<Badge tone="warning">未确认</Badge>} />
          <ExamRow exam={latestDraft} primary />
          {drafts.length > 1 ? (
            <details className="border-t border-white/10 pt-3">
              <summary className="cursor-pointer text-sm text-zinc-400">其他未完成模拟（{drafts.length - 1}）</summary>
              <div className="mt-3 grid gap-2">{drafts.slice(1).map((exam) => <ExamRow key={exam.id} exam={exam} />)}</div>
            </details>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-3">
        <SectionHeader title="已确认记录" description="已确认的成绩和失分只读，可继续选择补救动作。" meta={<Badge>{history.length} 场</Badge>} />
        {history.length > 0
          ? <div className="grid gap-2">{history.map((exam) => <ExamRow key={exam.id} exam={exam} />)}</div>
          : <EmptyState title="还没有已确认的模拟考试" description="完成一场模拟并确认事实后，会在这里形成可追溯记录。" />}
      </section>

      <SimulationListClient />
    </PageFrame>
  );
}

type Exam = Awaited<ReturnType<typeof listSimulationExams>>[number];

function ExamRow({ exam, primary = false }: { exam: Exam; primary?: boolean }) {
  const lossCount = exam.subjectResults.reduce((total, result) => total + result.lossItems.filter((item) => !item.archivedAt).length, 0);
  const nextAction = exam.status === "DRAFT" ? (exam.subjectResults.length > 0 ? "核对并确认" : "录入分科成绩") : (lossCount > 0 ? "选择补救" : "查看考试事实");
  return (
    <Link href={`/test/simulations/${exam.id}`} className={`group grid gap-3 border px-4 py-4 transition-colors sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center ${primary ? "border-teal-400/30 bg-teal-500/[0.06]" : "border-white/10 bg-white/[0.02] hover:border-white/20"}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-white group-hover:text-teal-200">{exam.name}</span>
          <Badge tone={exam.status === "DRAFT" ? "warning" : "success"}>{exam.status === "DRAFT" ? "未确认" : "已确认"}</Badge>
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          {new Date(exam.examDate).toLocaleDateString("zh-CN")} · {exam.totalsSource === "legacy_fallback" ? "旧版总分记录" : `${exam.actualScore ?? 0} / ${exam.targetScore ?? 0} 分`} · {exam.subjectResults.length} 科 · {lossCount} 条失分
        </p>
        {exam.warnings[0] ? <p className="mt-1 text-xs text-amber-200">{exam.warnings[0]}</p> : null}
      </div>
      <span className="inline-flex items-center gap-2 text-sm text-teal-300">{nextAction}<ArrowRight size={16} /></span>
    </Link>
  );
}
