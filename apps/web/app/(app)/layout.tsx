import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { QuickReviewActivityGuardProvider } from "@/components/quick-review-activity-guard";
import { getCurrentUser } from "@/lib/auth/session";
import { getAppShellStatus } from "@/lib/study/app-shell-service";

export const dynamic = "force-dynamic";

export default async function ProtectedAppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const status = await getAppShellStatus(user.id);

  return (
    <QuickReviewActivityGuardProvider userId={user.id}>
      <AppShell initialStatus={status} email={user.email} userId={user.id}>
        {children}
      </AppShell>
    </QuickReviewActivityGuardProvider>
  );
}
