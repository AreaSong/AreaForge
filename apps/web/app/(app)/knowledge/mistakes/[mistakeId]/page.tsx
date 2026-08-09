import { notFound, redirect } from "next/navigation";
import { MistakeDetailClient } from "@/components/mistake-detail-client";
import { PageFrame } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, sanitizeReturnPath } from "@/lib/navigation/app-navigation";
import { getOwnedMistakeDetail } from "@/lib/study/mistakes-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/mistakes/mistake");

export default async function KnowledgeMistakeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ mistakeId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { mistakeId } = await params;
  const query = await searchParams;
  const returnTo = query.returnTo ? sanitizeReturnPath(query.returnTo) : undefined;
  const detail = await getOwnedMistakeDetail(mistakeId, user.id);
  if (!detail) notFound();

  return (
    <PageFrame variant="content-focus">
      <MistakeDetailClient
        key={detail.mistake.id}
        userId={user.id}
        mistake={detail.mistake}
        readOnly={detail.readOnly}
        subjectArchived={detail.subjectArchived}
        workspaceName={detail.workspaceName}
        returnTo={returnTo}
        renderedAt={new Date().toISOString()}
      />
    </PageFrame>
  );
}
