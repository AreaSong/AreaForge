import Link from "next/link";
import { redirect } from "next/navigation";
import { AiDraftPanel } from "@/components/ai-draft-panel";
import { NoteLibrary } from "@/components/note-library";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { listNotes } from "@/lib/study/notes-service";
import { listStudyTasks, listSubjects } from "@/lib/study/service";
import { listSyllabusOptionsShared } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/notes");

export default async function KnowledgeNotesPage({ searchParams }: { searchParams: Promise<{ subjectId?: string; syllabusNodeId?: string; taskId?: string; mastery?: string; review?: string; create?: string; q?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const query = await searchParams;
  const [subjects, tasks, nodes, notes] = await Promise.all([
    listSubjects(user.id),
    listStudyTasks(user.id),
    listSyllabusOptionsShared(user.id),
    listNotes(user.id, { q: query.q }),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-white">知识卡片</h1>
      <p className="text-sm text-zinc-500">
        整理自己的理解、题解和复盘产出。
        <Link className="ml-2 text-teal-300 hover:underline" href="/knowledge/canvas">
          回到画布
        </Link>
      </p>
      <NoteLibrary
        userId={user.id}
        subjects={subjects}
        tasks={tasks}
        nodes={nodes}
        notes={notes}
        initialSubjectId={query.subjectId}
        initialSyllabusNodeId={query.syllabusNodeId}
        initialTaskId={query.taskId}
        initialMasteryStatus={query.mastery}
        initialReviewFilter={query.review}
        initialQuery={query.q}
        initialCreate={query.create === "1"}
      />
      <details className="border-t border-white/10 pt-4">
        <summary className="cursor-pointer text-sm text-zinc-500 hover:text-zinc-300">AI 卡片草稿</summary>
        <div className="mt-3"><AiDraftPanel endpoint="knowledge-card" userId={user.id} /></div>
      </details>
    </div>
  );
}
