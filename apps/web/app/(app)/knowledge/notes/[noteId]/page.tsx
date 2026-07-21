import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getNoteById } from "@/lib/study/notes-service";

export const dynamic = "force-dynamic";

export default async function KnowledgeNoteDetailPage({
  params,
}: {
  params: Promise<{ noteId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { noteId } = await params;
  const note = await getNoteById(noteId);
  if (!note) redirect("/knowledge/notes");

  return (
    <article className="space-y-4">
      <Link className="text-sm text-teal-300 hover:underline" href="/knowledge/notes">
        返回卡片列表
      </Link>
      <header>
        <p className="text-xs text-zinc-500">
          {note.kind} · {note.subjectName}
        </p>
        <h2 className="mt-1 text-2xl font-semibold text-white">{note.title}</h2>
      </header>
      <pre className="whitespace-pre-wrap rounded-md border border-white/10 bg-black/20 p-4 text-sm text-zinc-200">
        {note.content}
      </pre>
    </article>
  );
}
