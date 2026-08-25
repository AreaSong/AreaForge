import { prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { resolveActiveWorkspace } from "./exam-workspace-service";
import { parseSessionEvidenceReceipt } from "./session-evidence-contract";
import { serializeSession } from "./session-serializer";
import type { StudySessionDto, StudySessionEvidenceReceiptDto } from "@/lib/contracts";

const sessionInclude = {
  subject: true,
  task: true,
  syllabusNode: true,
  closeout: true,
  devicePresences: true,
  knowledgeLinks: {
    include: { knowledgePoint: { select: { id: true, title: true, masteryState: true } } },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

export async function getActiveStudySession(actorId: string): Promise<StudySessionDto | null> {
  const workspace = await resolveActiveWorkspace(actorId);
  const session = await prisma.studySession.findFirst({
    where: {
      userId: actorId,
      workspaceId: workspace.id,
      subject: { workspaceId: workspace.id },
      status: { in: ["RUNNING", "PAUSED", "CLOSING"] },
    },
    include: sessionInclude,
    orderBy: { startedAt: "desc" },
  });

  return session ? serializeSession(session) : null;
}

export async function getStudySessionById(id: string, actorId: string): Promise<StudySessionDto | null> {
  const workspace = await resolveActiveWorkspace(actorId);
  const session = await prisma.studySession.findFirst({
    where: { id, userId: actorId, workspaceId: workspace.id },
    include: sessionInclude,
  });
  return session ? serializeSession(session) : null;
}

export async function listStudySessionEvidenceReceipts(
  sessionId: string,
  actorId: string,
): Promise<StudySessionEvidenceReceiptDto[]> {
  const workspace = await resolveActiveWorkspace(actorId);
  const ownedSession = await prisma.studySession.findFirst({
    where: { id: sessionId, subject: { workspaceId: workspace.id } },
    select: { id: true },
  });
  if (!ownedSession) throw new ApiError("SESSION_NOT_FOUND", 404);
  const events = await prisma.auditEvent.findMany({
    where: {
      actorId,
      action: "STUDY_SESSION_EVIDENCE_LINKED",
      entityType: "StudySession",
      entityId: sessionId,
    },
    orderBy: { createdAt: "asc" },
    select: { metadata: true },
  });
  return events.flatMap((event) => {
    const receipt = parseSessionEvidenceReceipt(event.metadata);
    return receipt ? [receipt] : [];
  });
}
