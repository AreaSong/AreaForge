import { redirect } from "next/navigation";
import { StudyResourceWorkbench } from "@/components/study-resource-workbench";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import {
  getStudyResourceEditorOptions,
  listStudyResources,
} from "@/lib/study/study-resource-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/resources");

export default async function KnowledgeResourcesPage({ searchParams }: { searchParams: Promise<{ subjectId?: string; create?: string; q?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const [resources, options] = await Promise.all([
    listStudyResources(user.id, { includeArchived: true, q: query.q }),
    getStudyResourceEditorOptions(user.id),
  ]);

  return (
    <StudyResourceWorkbench
      userId={user.id}
      resources={resources.filter((resource) => !resource.archivedAt)}
      archivedResources={resources.filter((resource) => Boolean(resource.archivedAt))}
      options={options}
      initialSubjectId={query.subjectId}
      initialCreate={query.create === "1"}
    />
  );
}
