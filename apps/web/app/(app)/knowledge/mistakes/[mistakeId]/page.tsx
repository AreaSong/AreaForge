import { notFound, redirect } from "next/navigation";
import { MistakeDetailClient } from "@/components/mistake-detail-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { getOwnedMistakeDetail } from "@/lib/study/mistakes-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/mistakes/mistake");

export default async function KnowledgeMistakeDetailPage({
  params,
}: {
  params: Promise<{ mistakeId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { mistakeId } = await params;
  const detail = await getOwnedMistakeDetail(mistakeId, user.id);
  if (!detail) notFound();

  return (
    <MistakeDetailClient
      key={detail.mistake.id}
      userId={user.id}
      mistake={detail.mistake}
      readOnly={detail.readOnly}
      subjectArchived={detail.subjectArchived}
      workspaceName={detail.workspaceName}
    />
  );
}
