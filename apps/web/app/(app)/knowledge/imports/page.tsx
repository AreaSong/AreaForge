import { redirect } from "next/navigation";
import { AiDraftPanel } from "@/components/ai-draft-panel";
import { LearningTreeImportClient } from "@/components/learning-tree-import-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import {
  listLearningTreeExportOptions,
  listLearningTreeImports,
} from "@/lib/study/learning-tree-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/imports");

export default async function KnowledgeImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const initialView = query.mode === "import" || query.mode === "export" ? query.mode : "overview";
  const [allImports, exportOptions] = await Promise.all([
    listLearningTreeImports(user.id, { includeArchived: true }),
    listLearningTreeExportOptions(user.id),
  ]);

  return <LearningTreeImportClient
    userId={user.id}
    imports={allImports.filter((item) => !item.archivedAt)}
    archivedImports={allImports.filter((item) => Boolean(item.archivedAt))}
    exportOptions={exportOptions}
    initialView={initialView}
    aiDraftPanel={<AiDraftPanel endpoint="learning-tree" userId={user.id} />}
  />;
}
