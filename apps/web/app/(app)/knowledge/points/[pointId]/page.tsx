import { ArrowLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { KnowledgePointDetail } from "@/components/knowledge-point-detail";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, sanitizeReturnPath } from "@/lib/navigation/app-navigation";
import { getKnowledgePoint } from "@/lib/study/knowledge-point-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/points/detail");

export default async function KnowledgePointDetailPage({ params, searchParams }: { params: Promise<{ pointId: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { pointId } = await params;
  const query = await searchParams;
  const returnTo = query.returnTo ? sanitizeReturnPath(query.returnTo) : "/knowledge/points";
  const knowledgePoint = await getKnowledgePoint(user.id, pointId);
  if (!knowledgePoint) notFound();

  return (
    <PageFrame variant="content-focus">
      <PageHeader
        eyebrow={`${knowledgePoint.subject.name} · 知识点`}
        title={knowledgePoint.title}
        description={knowledgePoint.boundary ?? "把这个知识点当作独立对象维护，再从学习、复测和复盘中积累掌握证据。"}
        back={<ButtonLink href={returnTo} variant="ghost" size="sm"><ArrowLeft size={15} aria-hidden />返回知识点</ButtonLink>}
      />
      <KnowledgePointDetail knowledgePoint={knowledgePoint} />
    </PageFrame>
  );
}
