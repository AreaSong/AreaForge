import { redirect } from "next/navigation";
import { WorkspaceMembershipClient } from "@/components/workspace-membership-client";
import { ButtonLink } from "@/components/ui/button";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { getAuthEnv } from "@/lib/auth/env";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { listExamWorkspaces } from "@/lib/study/exam-workspace-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/settings/workspaces");

export default async function WorkspaceSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?returnTo=/settings/workspaces");
  const workspaces = await listExamWorkspaces(user.id);
  return (
    <PageFrame variant="dashboard-wide" className="space-y-6">
      <PageHeader
        eyebrow="设置 / 工作区与成员"
        title="工作区和成员"
        description="管理当前工作区、邀请、成员离开/移除和所有权转移。成员身份不会自动开放私密学习正文。"
        action={(
          <>
            <ButtonLink href="/settings/exams" variant="secondary">考试与科目</ButtonLink>
            <ButtonLink href="/settings/exams?setup=1">新建工作区</ButtonLink>
          </>
        )}
      />
      <WorkspaceMembershipClient
        currentUserId={user.id}
        multiUserEnabled={getAuthEnv().AUTH_MULTI_USER_ENABLED}
        workspaces={workspaces}
      />
    </PageFrame>
  );
}
