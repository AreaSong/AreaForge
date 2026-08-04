import { parseSafeMarkdown } from "@areaforge/core";
import { notFound, redirect } from "next/navigation";
import { NoteDetailClient } from "@/components/note-detail-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, sanitizeReturnPath } from "@/lib/navigation/batch7";
import { getNoteEditorOptions, getOwnedNoteDetail } from "@/lib/study/notes-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/cards/note");

export default async function KnowledgeCardDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ noteId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { noteId } = await params;
  const query = await searchParams;
  const returnTo = query.returnTo ? sanitizeReturnPath(query.returnTo) : undefined;
  const user = await getCurrentUser();
  if (!user) {
    const currentPath = `/knowledge/cards/${encodeURIComponent(noteId)}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`;
    redirect(`/login?returnTo=${encodeURIComponent(currentPath)}`);
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
      returnTo={returnTo}
    />
  );
}
