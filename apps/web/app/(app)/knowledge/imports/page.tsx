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

export default async function KnowledgeImportsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [allImports, exportOptions] = await Promise.all([
    listLearningTreeImports(user.id, { includeArchived: true }),
    listLearningTreeExportOptions(user.id),
  ]);

  return (
    <div className="space-y-4">
      <details className="rounded-md border border-white/10 p-3">
        <summary className="cursor-pointer text-sm text-teal-300">学习树 AI 草稿</summary>
        <div className="mt-3"><AiDraftPanel endpoint="learning-tree" userId={user.id} /></div>
      </details>
      <LearningTreeImportClient
        userId={user.id}
        imports={allImports.filter((item) => !item.archivedAt)}
        archivedImports={allImports.filter((item) => Boolean(item.archivedAt))}
        exportOptions={exportOptions}
      />
    </div>
  );
}
