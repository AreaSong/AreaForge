import KnowledgeNotesPage from "../notes/page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/cards");

export default function KnowledgeCardsPage({ searchParams }: { searchParams: Promise<{ subjectId?: string; syllabusNodeId?: string; taskId?: string; mastery?: string; review?: string; create?: string; q?: string }> }) {
  return KnowledgeNotesPage({ searchParams });
}
