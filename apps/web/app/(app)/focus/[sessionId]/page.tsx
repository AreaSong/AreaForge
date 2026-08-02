import { notFound, redirect } from "next/navigation";
import { FocusSessionClient } from "@/components/focus-session-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getActiveStudySession, getStudySessionById, listStudySessionEvidenceReceipts } from "@/lib/study/service";
import { getRouteMetadata, sanitizeReturnPath } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/focus/session");

export default async function FocusSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { sessionId } = await params;
  const query = await searchParams;
  const returnTo = sanitizeReturnPath(query.returnTo);

  const session = await getStudySessionById(sessionId, user.id);
  if (!session) {
    notFound();
  }

  const active = await getActiveStudySession(user.id);
  const evidenceReceipts = await listStudySessionEvidenceReceipts(session.id, user.id);

  return (
    <FocusSessionClient
      userId={user.id}
      session={session}
      activeConflictId={active && active.id !== sessionId ? active.id : null}
      returnTo={returnTo}
      initialNow={new Date().toISOString()}
      initialEvidenceReceipts={evidenceReceipts}
    />
  );
}
