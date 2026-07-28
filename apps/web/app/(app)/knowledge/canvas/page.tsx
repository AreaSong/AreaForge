import { redirect } from "next/navigation";
import { KnowledgeCanvasClient } from "@/components/knowledge-canvas-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { getKnowledgeCanvas } from "@/lib/study/knowledge-canvas-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/canvas");

export default async function KnowledgeCanvasPage({ searchParams }: { searchParams: Promise<{ workspaceId?: string; subjectId?: string; syllabusNodeId?: string; focus?: string; q?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const canvas = await getKnowledgeCanvas(user.id, {
    workspaceId: query.workspaceId,
    focus: query.focus ?? (query.syllabusNodeId ? `SYLLABUS_NODE:${query.syllabusNodeId}` : undefined),
    subjectId: query.subjectId,
    q: query.q,
    depth: 1,
    limit: 80,
  });
  return <KnowledgeCanvasClient initial={canvas} initialQuery={query.q} />;
}
