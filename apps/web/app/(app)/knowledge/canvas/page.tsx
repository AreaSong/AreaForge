import { redirect } from "next/navigation";
import { KnowledgeCanvasClient } from "@/components/knowledge-canvas-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getKnowledgeCanvas } from "@/lib/study/knowledge-canvas-service";

export const dynamic = "force-dynamic";

export default async function KnowledgeCanvasPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const canvas = await getKnowledgeCanvas(user.id, { depth: 1, limit: 80 });
  return <KnowledgeCanvasClient initial={canvas} />;
}
