import { redirect } from "next/navigation";
import { WorkspaceSettingsClient } from "@/components/workspace-settings-client";
import { PageFrame } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import {
  findActiveWorkspaceOrNull,
  listExamWorkspaces,
  listSubjectGroups,
  listWorkspaceSubjects,
  previewWorkspaceTakeover,
} from "@/lib/study/exam-workspace-service";
import { listSubjectDuplicatePreviews } from "@/lib/study/subject-duplicate-query-service";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/settings/exams");

export default async function SettingsExamsPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const [workspaces, active, takeover] = await Promise.all([
    listExamWorkspaces(user.id),
    findActiveWorkspaceOrNull(user.id),
    previewWorkspaceTakeover(user.id).catch(() => null),
  ]);
  const [subjects, groups, duplicateSets] = active
    ? await Promise.all([
        listWorkspaceSubjects(user.id, active.id),
        listSubjectGroups(user.id, active.id),
        listSubjectDuplicatePreviews(user.id, active.id),
      ])
    : [[], [], []];

  return (
    <PageFrame variant="dashboard-wide" className="space-y-6">
      <WorkspaceSettingsClient
        userId={user.id}
        workspaces={workspaces}
        activeId={active?.id ?? null}
        subjects={subjects}
        groups={groups}
        duplicateSets={duplicateSets}
        takeover={takeover}
        setupMode={params.setup === "1" || !active}
      />
    </PageFrame>
  );
}
