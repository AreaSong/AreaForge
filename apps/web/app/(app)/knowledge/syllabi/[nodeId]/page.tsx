import { notFound, redirect } from "next/navigation";
import { SyllabusDetailClient } from "@/components/syllabus-detail-client";
import { PageFrame } from "@/components/ui/page";
import { ApiError } from "@/lib/api/responses";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, sanitizeReturnPath } from "@/lib/navigation/batch7";
import { listReviewSchedules } from "@/lib/study/review-schedule-service";
import { getSyllabusNode, listSyllabusOptionsShared } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/syllabi/node");

export default async function KnowledgeSyllabiDetailPage({ params, searchParams }: { params: Promise<{ nodeId: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { nodeId } = await params;
  const query = await searchParams;
  const returnTo = query.returnTo ? sanitizeReturnPath(query.returnTo) : undefined;
  const [node, parentOptions, schedules] = await Promise.all([
    getSyllabusNode(user.id, nodeId).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) notFound();
      throw error;
    }),
    listSyllabusOptionsShared(user.id),
    listReviewSchedules(user.id),
  ]);

  return (
    <PageFrame variant="content-focus">
      <SyllabusDetailClient node={node} parentOptions={parentOptions} schedule={schedules.find((item) => item.syllabusNodeId === node.id) ?? null} renderedAt={new Date().toISOString()} returnTo={returnTo} />
    </PageFrame>
  );
}
