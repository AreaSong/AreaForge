import { redirect } from "next/navigation";
import { KnowledgeRetestCreateForm } from "@/components/knowledge-retest-create-form";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, sanitizeReturnPath } from "@/lib/navigation/app-navigation";
import { listKnowledgePoints } from "@/lib/study/knowledge-point-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/test/retests/new");

export default async function NewKnowledgeRetestPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const points = await listKnowledgePoints(user.id);
  const query = await searchParams;
  const returnTo = sanitizeReturnPath(query.returnTo ?? "/test/retests");
  return <PageFrame variant="content-focus"><PageHeader eyebrow="检验 · 专项复测" title="安排专项复测" description="知识点可以跨多个阶段和考纲；本次只选择要一起检验的对象。" /><KnowledgeRetestCreateForm points={points} returnTo={returnTo} /></PageFrame>;
}
