import { redirect } from "next/navigation";
import { KnowledgeRetestCreateForm } from "@/components/knowledge-retest-create-form";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { listKnowledgePoints } from "@/lib/study/knowledge-point-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/test/retests/new");

export default async function NewKnowledgeRetestPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const points = await listKnowledgePoints(user.id);
  return <PageFrame variant="content-focus"><PageHeader eyebrow="检验 · 专项复测" title="安排专项复测" description="知识点可以跨多个阶段和考纲；本次只选择要一起检验的对象。" /><KnowledgeRetestCreateForm points={points} /></PageFrame>;
}
