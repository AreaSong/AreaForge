import { redirect } from "next/navigation";
import { WorkspaceSettingsClient } from "@/components/workspace-settings-client";
import { getCurrentUser } from "@/lib/auth/session";
import {
  findActiveWorkspaceOrNull,
  listExamWorkspaces,
  listSubjectGroups,
  listWorkspaceSubjects,
  previewWorkspaceTakeover,
} from "@/lib/study/exam-workspace-service";

export const dynamic = "force-dynamic";

export default async function WorkspaceSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const workspaces = await listExamWorkspaces(user.id);
  const active = await findActiveWorkspaceOrNull(user.id);
  const subjects = active ? await listWorkspaceSubjects(user.id, active.id) : [];
  const groups = active ? await listSubjectGroups(user.id, active.id) : [];
  const takeover = await previewWorkspaceTakeover(user.id).catch(() => null);

  return (
    <WorkspaceSettingsClient
      workspaces={workspaces}
      activeId={active?.id ?? null}
      subjects={subjects}
      groups={groups}
      takeover={takeover}
      setupMode={params.setup === "1" || !active}
    />
  );
}
