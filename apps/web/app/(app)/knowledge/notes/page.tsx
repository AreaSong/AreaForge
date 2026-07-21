import Link from "next/link";
import { redirect } from "next/navigation";
import { NoteLibrary } from "@/components/note-library";
import { getCurrentUser } from "@/lib/auth/session";
import { listNotes } from "@/lib/study/notes-service";
import { listStudyTasks, listSubjects } from "@/lib/study/service";
import { listSyllabusOptionsShared } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";

export default async function KnowledgeNotesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [subjects, tasks, nodes, notes] = await Promise.all([
    listSubjects(),
    listStudyTasks(),
    listSyllabusOptionsShared(),
    listNotes(),
  ]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">
        知识卡片复用 Note 对象。详情也可从画布打开。
        <Link className="ml-2 text-teal-300 hover:underline" href="/knowledge/canvas">
          回到画布
        </Link>
      </p>
      <NoteLibrary subjects={subjects} tasks={tasks} nodes={nodes} notes={notes} />
    </div>
  );
}
