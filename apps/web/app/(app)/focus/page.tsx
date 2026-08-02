import { redirect } from "next/navigation";
import { FocusLauncher } from "@/components/focus-launcher";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { getActiveStudySession, listSubjects } from "@/lib/study/service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/focus");

export default async function FocusLandingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [activeSession, subjects] = await Promise.all([
    getActiveStudySession(user.id),
    listSubjects(user.id),
  ]);
  if (activeSession) redirect(`/focus/${activeSession.id}`);
  return <FocusLauncher subjects={subjects} userId={user.id} />;
}
