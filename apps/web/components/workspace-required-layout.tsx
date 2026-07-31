import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { findActiveWorkspaceOrNull } from "@/lib/study/exam-workspace-service";

export async function WorkspaceRequiredLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const workspace = await findActiveWorkspaceOrNull(user.id);
  if (!workspace) redirect("/settings/workspace?setup=1");
  return children;
}
