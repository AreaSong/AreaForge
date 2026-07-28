import { parseSafeMarkdown } from "@areaforge/core";
import { notFound, redirect } from "next/navigation";
import { NoteDetailClient } from "@/components/note-detail-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { getNoteEditorOptions, getOwnedNoteDetail } from "@/lib/study/notes-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/notes/note");

export default async function KnowledgeNoteDetailPage({
  params,
}: {
  params: Promise<{ noteId: string }>;
}) {
  const { noteId } = await params;
  const user = await getCurrentUser();
  if (!user) {
    const returnTo = `/knowledge/notes/${encodeURIComponent(noteId)}`;
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  const detail = await getOwnedNoteDetail(noteId, user.id);
  if (!detail) notFound();
  const options = detail.readOnly
    ? { subjects: [], tasks: [], syllabusNodes: [], resources: [] }
    : await getNoteEditorOptions(user.id);
  const { note } = detail;

  return (
    <NoteDetailClient
      key={`${note.id}:${note.revision}`}
      userId={user.id}
      note={note}
      options={options}
      readOnly={detail.readOnly}
      subjectArchived={detail.subjectArchived}
      workspaceName={detail.workspaceName}
      markdownNodes={parseSafeMarkdown(note.content)}
      renderedAt={new Date().toISOString()}
    />
  );
}
