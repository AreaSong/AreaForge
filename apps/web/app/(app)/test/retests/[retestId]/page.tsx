import { notFound, redirect } from "next/navigation";
import { KnowledgeRetestDetailClient } from "@/components/knowledge-retest-detail-client";
import { PageFrame } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, sanitizeReturnPath } from "@/lib/navigation/batch7";
import { getKnowledgeRetest } from "@/lib/study/knowledge-retest-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/test/retests/detail");

export default async function KnowledgeRetestDetailPage({ params, searchParams }: { params: Promise<{ retestId: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { retestId } = await params;
  const retest = await getKnowledgeRetest(user.id, retestId);
  if (!retest) notFound();
  const query = await searchParams;
  const returnTo = sanitizeReturnPath(query.returnTo ?? "/test/retests");
  return <PageFrame variant="content-focus"><KnowledgeRetestDetailClient initial={retest} userId={user.id} returnTo={returnTo} /></PageFrame>;
}
