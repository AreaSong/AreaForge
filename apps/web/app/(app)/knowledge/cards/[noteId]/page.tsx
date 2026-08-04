import KnowledgeNoteDetailPage from "../../notes/[noteId]/page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/cards/note");

export default function KnowledgeCardDetailPage({ params, searchParams }: { params: Promise<{ noteId: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  return KnowledgeNoteDetailPage({ params, searchParams });
}
