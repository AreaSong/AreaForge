import { redirect } from "next/navigation";
import { MistakeLibrary } from "@/components/mistake-library";
import { getCurrentUser } from "@/lib/auth/session";
import { listMistakes } from "@/lib/study/mistakes-service";
import { listSubjects } from "@/lib/study/service";
import { listSyllabusOptions } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";

export default async function KnowledgeMistakesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [subjects, nodes, mistakes] = await Promise.all([listSubjects(), listSyllabusOptions(), listMistakes()]);
  return <MistakeLibrary subjects={subjects} nodes={nodes} mistakes={mistakes} />;
}
