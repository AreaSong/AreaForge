import { notFound, redirect } from "next/navigation";
import { StudyResourceDetailClient } from "@/components/study-resource-detail-client";
import { PageFrame } from "@/components/ui/page";
import { ApiError } from "@/lib/api/responses";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, sanitizeReturnPath } from "@/lib/navigation/batch7";
import { getStudyResource, getStudyResourceEditorOptions } from "@/lib/study/study-resource-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/resources/resource");

export default async function KnowledgeResourceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ resourceId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { resourceId } = await params;
  const query = await searchParams;
  const returnTo = query.returnTo ? sanitizeReturnPath(query.returnTo) : undefined;
  const user = await getCurrentUser();
  if (!user) {
    const currentPath = `/knowledge/resources/${encodeURIComponent(resourceId)}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`;
    redirect(`/login?returnTo=${encodeURIComponent(currentPath)}`);
  }
  const [resource, options] = await Promise.all([
    getStudyResource(user.id, resourceId),
    getStudyResourceEditorOptions(user.id),
  ]).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  return (
    <PageFrame variant="content-focus">
      <StudyResourceDetailClient userId={user.id} resource={resource} options={options} returnTo={returnTo} />
    </PageFrame>
  );
}
