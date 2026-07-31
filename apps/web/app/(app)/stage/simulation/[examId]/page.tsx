import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DetailHeading } from "@/components/detail-heading";
import { SimulationDetailClient } from "@/components/simulation-detail-client";
import { ApiError } from "@/lib/api/responses";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { listWorkspaceSubjects, resolveActiveWorkspace } from "@/lib/study/exam-workspace-service";
import { getSimulationExam, listSimulationRemediations } from "@/lib/study/simulation-service";
import { listSyllabusOptions } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/stage/simulation/exam");

export default async function SimulationExamPage({ params }: { params: Promise<{ examId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { examId } = await params;
  const data = await loadPageData(examId, user.id);

  return (
    <section className="space-y-5">
      <Link href="/stage/simulation" className="text-sm text-teal-300">← 返回模拟</Link>
      <div>
        <DetailHeading className="text-2xl font-semibold text-white">{data.exam.name}</DetailHeading>
        <p className="mt-1 text-sm text-zinc-400">整场总览与单科切换；输入按 0.5 分步进。</p>
      </div>
      {data.exam.totalsSource === "legacy_fallback" ? (
        <div className="rounded-md border border-amber-400/20 bg-amber-500/5 p-4 text-sm text-amber-100">
          <p className="font-medium">这是无分科的旧记录。</p>
          <p className="mt-1 text-amber-100/80">
            历史总分：{data.exam.legacyDisplayTotals?.actualScore ?? "—"} / {data.exam.legacyDisplayTotals?.targetScore ?? "—"}。
            {data.exam.status === "DRAFT" ? " 请按科目补齐结果；首次保存成功后会升级为分科记录。" : " 该记录已确认，只读保留。"}
          </p>
        </div>
      ) : null}
      <SimulationDetailClient userId={user.id} exam={data.exam} subjects={data.subjects} syllabus={data.syllabus} remediations={data.remediations} />
    </section>
  );
}

async function loadPageData(examId: string, actorId: string) {
  try {
    const workspace = await resolveActiveWorkspace(actorId);
    const [exam, subjects, syllabus, remediations] = await Promise.all([
      getSimulationExam(examId, actorId),
      listWorkspaceSubjects(actorId, workspace.id),
      listSyllabusOptions(actorId),
      listSimulationRemediations(examId, actorId),
    ]);
    return { exam, subjects, syllabus, remediations };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
