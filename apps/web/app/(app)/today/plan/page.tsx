import Link from "next/link";
import { redirect } from "next/navigation";
import { PlanRollingClient } from "@/components/plan-rolling-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getPlanRolling } from "@/lib/study/plan-rolling-service";
import { findActiveWorkspaceOrNull, listWorkspaceSubjects } from "@/lib/study/exam-workspace-service";

export const dynamic = "force-dynamic";

export default async function TodayPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; subjectId?: string; status?: string; q?: string; createMinimum?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const plan = await getPlanRolling(user.id, {
    date: params.date,
    subjectId: params.subjectId,
    status: params.status,
    q: params.q,
  });

  if (plan.setupRequired) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold text-white">计划</h1>
        <p className="text-sm text-zinc-400">需要先设置考试工作区。</p>
        <Link href="/settings/workspace?setup=1" className="text-teal-300 hover:underline">
          设置考试目标
        </Link>
      </section>
    );
  }

  const workspace = await findActiveWorkspaceOrNull(user.id);
  const subjects = workspace ? await listWorkspaceSubjects(user.id, workspace.id) : [];

  return (
    <PlanRollingClient
      initial={plan}
      subjects={subjects.map((subject) => ({ id: subject.id, name: subject.name }))}
      createMinimum={params.createMinimum === "1"}
      query={{
        date: params.date,
        subjectId: params.subjectId,
        status: params.status,
        q: params.q,
      }}
    />
  );
}
