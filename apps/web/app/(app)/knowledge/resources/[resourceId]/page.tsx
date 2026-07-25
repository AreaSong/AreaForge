import { redirect } from "next/navigation";
import { StudyResourceDetailClient } from "@/components/study-resource-detail-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getStudyResource, getStudyResourceEditorOptions } from "@/lib/study/study-resource-service";

export const dynamic = "force-dynamic";

export default async function KnowledgeResourceDetailPage({ params }: { params: Promise<{ resourceId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { resourceId } = await params;
  const [resource, options] = await Promise.all([
    getStudyResource(user.id, resourceId),
    getStudyResourceEditorOptions(user.id),
  ]);
  return <StudyResourceDetailClient resource={resource} options={options} />;
}
