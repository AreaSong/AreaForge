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

export default async function KnowledgeNotesPage({ searchParams }: { searchParams: Promise<{ subjectId?: string; syllabusNodeId?: string; taskId?: string; create?: string; q?: string }> }) {
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
      <h1 className="text-2xl font-semibold text-white">知识卡片</h1>
      <p className="text-sm text-zinc-500">
        知识卡片复用 Note 对象。详情也可从画布打开。
        <Link className="ml-2 text-teal-300 hover:underline" href="/knowledge/canvas">
          回到画布
        </Link>
      </p>
      <details className="rounded-lg border border-white/10 p-3">
        <summary className="cursor-pointer text-sm text-teal-300">上下文 AI 草稿（需选中文本）</summary>
        <div className="mt-3">
          <AiDraftPanel endpoint="knowledge-card" userId={user.id} />
        </div>
      </details>
      <NoteLibrary userId={user.id} subjects={subjects} tasks={tasks} nodes={nodes} notes={notes} initialSubjectId={query.subjectId} initialSyllabusNodeId={query.syllabusNodeId} initialTaskId={query.taskId} initialCreate={query.create === "1"} />
    </div>
  );
}
