import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandBreadcrumb } from "@/components/brand-logo";
import { LongTermRiskPanel } from "@/components/long-term-risk-panel";
import { SyllabusManager } from "@/components/syllabus-manager";
import { getCurrentUser } from "@/lib/auth/session";
import { getLongTermRiskSummary } from "@/lib/study/long-term-risk-service";
import { listSubjects } from "@/lib/study/service";
import { getSyllabusMapOverview } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";

export default async function SyllabusPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [subjects, overview, longTermRisks] = await Promise.all([
    listSubjects(),
    getSyllabusMapOverview(),
    getLongTermRiskSummary(),
  ]);

  return (
    <main className="min-h-screen bg-[#080b0f] text-zinc-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <BrandBreadcrumb section="Syllabus" />
            <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
              考纲进度树
            </h1>
            <p className="mt-2 text-sm text-zinc-500">把任务和计时落到具体知识点。</p>
          </div>
          <Link
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10"
            href="/"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            返回作战台
          </Link>
        </header>

        <LongTermRiskPanel
          summary={longTermRisks}
          title="作战地图遗忘风险"
          description="考纲作战地图使用同一长期风险来源，遗忘风险会带出证据新鲜度和下一步动作。"
        />

        <SyllabusManager
          subjects={subjects}
          nodes={overview.nodes}
          summary={overview.summary}
          summaryBySubject={overview.summaryBySubject}
        />
      </div>
    </main>
  );
}
