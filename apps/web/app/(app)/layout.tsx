import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
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
    <AppShell initialStatus={status} email={user.email}>
      {children}
    </AppShell>
  );
}
