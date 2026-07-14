import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandBreadcrumb } from "@/components/brand-logo";
import { LongTermRiskPanel } from "@/components/long-term-risk-panel";
import { NoteLibrary } from "@/components/note-library";
import { getCurrentUser } from "@/lib/auth/session";
import { getLongTermRiskSummary } from "@/lib/study/long-term-risk-service";
import { listNotes } from "@/lib/study/notes-service";
import { listStudyTasks, listSubjects } from "@/lib/study/service";
import { listSyllabusTree } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";

export default async function NotesPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [subjects, tasks, nodes, notes, longTermRisks] = await Promise.all([
    listSubjects(),
    listStudyTasks(),
    listSyllabusTree(),
    listNotes(),
    getLongTermRiskSummary(),
  ]);

  return (
    <main className="min-h-screen bg-[#080b0f] text-zinc-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <BrandBreadcrumb section="Notes" />
            <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
              笔记与资料库
            </h1>
            <p className="mt-2 text-sm text-zinc-500">沉淀自己的理解、题解和下次复习线索。</p>
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
          title="复习提醒长期风险"
          description="笔记复习提醒与报告、考纲、模拟共用同一组长期风险原因，不单独生成冲突结论。"
        />

        <NoteLibrary subjects={subjects} tasks={tasks} nodes={nodes} notes={notes} />
      </div>
    </main>
  );
}
