import { ArrowLeft, NotebookPen } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NoteLibrary } from "@/components/note-library";
import { getCurrentUser } from "@/lib/auth/session";
import { listNotes } from "@/lib/study/notes-service";
import { listStudyTasks, listSubjects } from "@/lib/study/service";
import { listSyllabusTree } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";

export default async function NotesPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [subjects, tasks, nodes, notes] = await Promise.all([
    listSubjects(),
    listStudyTasks(),
    listSyllabusTree(),
    listNotes(),
  ]);

  return (
    <main className="min-h-screen bg-[#080b0f] text-zinc-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3 text-sm text-teal-300">
              <NotebookPen className="h-4 w-4" aria-hidden="true" />
              <span>AreaForge / Notes</span>
            </div>
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

        <NoteLibrary subjects={subjects} tasks={tasks} nodes={nodes} notes={notes} />
      </div>
    </main>
  );
}
