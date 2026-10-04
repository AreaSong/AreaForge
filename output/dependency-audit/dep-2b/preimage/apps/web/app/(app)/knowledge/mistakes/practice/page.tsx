import { redirect } from "next/navigation";
import { MistakePracticeClient } from "@/components/mistake-practice-client";
import { PageFrame } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { listMistakes } from "@/lib/study/mistakes-service";
import { listSubjects } from "@/lib/study/study-query-service";
import { listSyllabusOptions } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/mistakes/practice");

export default async function MistakePracticePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [mistakes, subjects, nodes] = await Promise.all([
    listMistakes(user.id),
    listSubjects(user.id),
    listSyllabusOptions(user.id),
  ]);
  return <PageFrame variant="workspace-full" className="p-4 sm:p-6"><MistakePracticeClient userId={user.id} mistakes={mistakes} subjects={subjects} nodes={nodes} /></PageFrame>;
}
