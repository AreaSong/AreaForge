import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { findSelectedMemberWorkspaceOrNull } from "@/lib/study/exam-workspace-service";

export async function WorkspaceRequiredLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const workspace = await findSelectedMemberWorkspaceOrNull(user.id);
  if (!workspace) redirect("/settings/exams?setup=1");
  return children;
}
