import { redirect } from "next/navigation";
import { KnowledgeCanvasClient } from "@/components/knowledge-canvas-client";
import { PageFrame } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { getKnowledgeCanvas } from "@/lib/study/knowledge-canvas-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/canvas");

export default async function KnowledgeCanvasPage({ searchParams }: { searchParams: Promise<{ workspaceId?: string; subjectId?: string; syllabusNodeId?: string; focus?: string; q?: string; entityType?: string; relation?: string; status?: string; view?: string; depth?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const requestedDepth = Number(query.depth);
  const depth = Number.isInteger(requestedDepth) && requestedDepth >= 1 && requestedDepth <= 4
    ? requestedDepth
    : 1;
  const canvas = await getKnowledgeCanvas(user.id, {
    workspaceId: query.workspaceId,
    focus: query.focus ?? (query.syllabusNodeId ? `SYLLABUS_NODE:${query.syllabusNodeId}` : undefined),
    subjectId: query.subjectId,
    q: query.q,
    entityType: query.entityType,
    status: query.status,
    depth,
    limit: 80,
  });
  return (
    <PageFrame variant="workspace-full">
      <KnowledgeCanvasClient
        initial={canvas}
        initialQuery={query.q}
        initialEntityType={query.entityType}
        initialSubjectId={query.subjectId}
        initialRelationKind={query.relation}
        initialStatus={query.status === "all" ? "all" : "active"}
        initialView={query.view === "list" ? "list" : "canvas"}
      />
    </PageFrame>
  );
}
