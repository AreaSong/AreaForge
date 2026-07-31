import { notFound, redirect } from "next/navigation";
import { StudyResourceDetailClient } from "@/components/study-resource-detail-client";
import { ApiError } from "@/lib/api/responses";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { getStudyResource, getStudyResourceEditorOptions } from "@/lib/study/study-resource-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/resources/resource");

export default async function KnowledgeResourceDetailPage({ params }: { params: Promise<{ resourceId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { resourceId } = await params;
  const [resource, options] = await Promise.all([
    getStudyResource(user.id, resourceId),
    getStudyResourceEditorOptions(user.id),
  ]).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  return <StudyResourceDetailClient userId={user.id} resource={resource} options={options} />;
}
