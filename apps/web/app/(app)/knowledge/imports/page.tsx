import { redirect } from "next/navigation";
import { LearningTreeImportClient } from "@/components/learning-tree-import-client";
import { getCurrentUser } from "@/lib/auth/session";
import {
  listLearningTreeExportOptions,
  listLearningTreeImports,
} from "@/lib/study/learning-tree-service";

export const dynamic = "force-dynamic";

export default async function KnowledgeImportsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [allImports, exportOptions] = await Promise.all([
    listLearningTreeImports(user.id, { includeArchived: true }),
    listLearningTreeExportOptions(user.id),
  ]);

  return (
    <LearningTreeImportClient
      userId={user.id}
      imports={allImports.filter((item) => !item.archivedAt)}
      archivedImports={allImports.filter((item) => Boolean(item.archivedAt))}
      exportOptions={exportOptions}
    />
  );
}
