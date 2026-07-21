import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SimulationDetailClient } from "@/components/simulation-detail-client";
import { ApiError } from "@/lib/api/responses";
import { getCurrentUser } from "@/lib/auth/session";
import { listWorkspaceSubjects, resolveActiveWorkspace } from "@/lib/study/exam-workspace-service";
import { getSimulationExam, listSimulationRemediations } from "@/lib/study/simulation-service";
import { listSyllabusOptions } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";

export default async function SimulationExamPage({ params }: { params: Promise<{ examId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { examId } = await params;
  const data = await loadPageData(examId, user.id);

  if (data.exam.totalsSource === "legacy_fallback") {
    return (
      <section className="space-y-4">
        <Link href="/stage/simulation" className="text-sm text-teal-300">← 返回模拟</Link>
        <h1 className="text-2xl font-semibold">{data.exam.name}</h1>
        <p className="rounded-md border border-amber-400/20 bg-amber-500/5 p-4 text-sm text-amber-100">
          这是无分科的旧记录，当前只读展示。补齐完整分科结果后才可编辑。
        </p>
        <p className="text-sm text-zinc-400">
          历史 totals：{data.exam.legacyDisplayTotals?.actualScore ?? "—"} / {data.exam.legacyDisplayTotals?.targetScore ?? "—"}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <Link href="/stage/simulation" className="text-sm text-teal-300">← 返回模拟</Link>
      <div>
        <h1 className="text-2xl font-semibold text-white">{data.exam.name}</h1>
        <p className="mt-1 text-sm text-zinc-400">整场总览与单科切换；输入按 0.5 分步进。</p>
      </div>
      <SimulationDetailClient exam={data.exam} subjects={data.subjects} syllabus={data.syllabus} remediations={data.remediations} />
    </section>
  );
}

async function loadPageData(examId: string, actorId: string) {
  try {
    const workspace = await resolveActiveWorkspace(actorId);
    const [exam, subjects, syllabus, remediations] = await Promise.all([
      getSimulationExam(examId, actorId),
      listWorkspaceSubjects(actorId, workspace.id),
      listSyllabusOptions(),
      listSimulationRemediations(examId, actorId),
    ]);
    return { exam, subjects, syllabus, remediations };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
