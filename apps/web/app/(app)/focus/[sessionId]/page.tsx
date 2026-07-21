import { redirect } from "next/navigation";
import { FocusSessionClient } from "@/components/focus-session-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getActiveStudySession } from "@/lib/study/service";
import { prisma } from "@areaforge/db";
import { sanitizeReturnPath } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";

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

  const session = await prisma.studySession.findUnique({
    where: { id: sessionId },
    include: { subject: true, task: true, syllabusNode: true },
  });
  if (!session) {
    redirect("/today");
  }

  const active = await getActiveStudySession();
  const dto = {
    id: session.id,
    subjectId: session.subjectId,
    subjectName: session.subject.name,
    taskId: session.taskId,
    taskTitle: session.task?.title ?? null,
    syllabusNodeId: session.syllabusNodeId,
    syllabusNodeTitle: session.syllabusNode?.title ?? null,
    status: session.status.toLowerCase() as "running" | "paused" | "completed" | "canceled",
    startedAt: session.startedAt.toISOString(),
    pausedAt: session.pausedAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
    accumulatedPauseSeconds: session.accumulatedPauseSeconds,
    effectiveMinutes: session.effectiveMinutes,
    qualityScore: session.qualityScore,
    isEffective: session.isEffective,
    understandingLevel: session.understandingLevel,
    minimalOutput: session.minimalOutput,
    nextAction: session.nextAction,
    producedNote: session.producedNote,
    producedMistake: session.producedMistake,
    isLowConversion: session.isLowConversion,
    antiFakeReason: session.antiFakeReason,
    requiredOutput: session.requiredOutput,
    closeoutVersion: session.closeoutVersion,
    note: session.note,
    goalMinutes: session.goalMinutes,
    startSource: session.startSource,
  };

  return (
    <FocusSessionClient
      session={dto}
      activeConflictId={active && active.id !== sessionId ? active.id : null}
      returnTo={returnTo}
    />
  );
}
