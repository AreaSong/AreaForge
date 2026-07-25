import { redirect } from "next/navigation";
import { MistakeLibrary } from "@/components/mistake-library";
import { getCurrentUser } from "@/lib/auth/session";
import { listMistakes } from "@/lib/study/mistakes-service";
import { listSubjects } from "@/lib/study/service";
import { listSyllabusOptions } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";

export default async function KnowledgeMistakesPage({ searchParams }: { searchParams: Promise<{ subjectId?: string; syllabusNodeId?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const [subjects, nodes, mistakes] = await Promise.all([
    listSubjects(user.id),
    listSyllabusOptions(user.id),
    listMistakes(user.id),
  ]);
  return <MistakeLibrary subjects={subjects} nodes={nodes} mistakes={mistakes} initialSubjectId={query.subjectId} initialSyllabusNodeId={query.syllabusNodeId} />;
}
