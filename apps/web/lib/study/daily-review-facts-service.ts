import { prisma, type Prisma } from "@areaforge/db";
import { getStudyDayRange } from "./date";
import { resolveActiveWorkspace } from "./exam-workspace-service";
import type { StudySessionEvidenceReceiptDto, StudySessionEvidenceTypeDto } from "./types";

export interface DailyReviewFactsDto {
  studyDayKey: string;
  totalMinutes: number;
  effectiveMinutes: number;
  effectiveSessionCount: number;
  lowConversionCount: number;
  plannedTaskCount: number;
  completedTaskCount: number;
  confirmedReviewCount: number;
  evidenceCounts: Record<StudySessionEvidenceTypeDto, number>;
  evidence: StudySessionEvidenceReceiptDto[];
  subjects: Array<{
    id: string;
    name: string;
    color: string;
    effectiveMinutes: number;
    sessionCount: number;
  }>;
}

export async function getDailyReviewFacts(actorId: string, targetDate = new Date()): Promise<DailyReviewFactsDto> {
  const workspace = await resolveActiveWorkspace(actorId);
  const day = getStudyDayRange(targetDate);
  const [sessions, tasks, reviewEvents] = await Promise.all([
    prisma.studySession.findMany({
      where: {
        subject: { workspaceId: workspace.id, archivedAt: null },
        status: "COMPLETED",
        startedAt: { gte: day.start, lt: day.end },
      },
      select: {
        id: true,
        subjectId: true,
        effectiveMinutes: true,
        isEffective: true,
        isLowConversion: true,
        subject: { select: { name: true, color: true } },
      },
      orderBy: { startedAt: "asc" },
    }),
    prisma.studyTask.findMany({
      where: {
        subject: { workspaceId: workspace.id, archivedAt: null },
        plannedDate: { gte: day.start, lt: day.end },
      },
      select: { status: true },
    }),
    prisma.reviewEvent.findMany({
      where: {
        learningDate: day.start,
        correctedEventId: null,
        reviewSchedule: { workspaceId: workspace.id },
      },
      select: { id: true },
    }),
  ]);

  const evidence = sessions.length > 0
    ? await listEvidenceReceipts(actorId, sessions.map((session) => session.id))
    : [];
  const subjectFacts = new Map<string, DailyReviewFactsDto["subjects"][number]>();
  for (const session of sessions) {
    const current = subjectFacts.get(session.subjectId) ?? {
      id: session.subjectId,
      name: session.subject.name,
      color: session.subject.color,
      effectiveMinutes: 0,
      sessionCount: 0,
    };
    current.effectiveMinutes += session.isEffective ? session.effectiveMinutes : 0;
    current.sessionCount += 1;
    subjectFacts.set(session.subjectId, current);
  }

  return {
    studyDayKey: day.key,
    totalMinutes: sessions.reduce((sum, session) => sum + session.effectiveMinutes, 0),
    effectiveMinutes: sessions.filter((session) => session.isEffective).reduce((sum, session) => sum + session.effectiveMinutes, 0),
    effectiveSessionCount: sessions.filter((session) => session.isEffective).length,
    lowConversionCount: sessions.filter((session) => session.isLowConversion).length,
    plannedTaskCount: tasks.length,
    completedTaskCount: tasks.filter((task) => task.status === "DONE").length,
    confirmedReviewCount: reviewEvents.length,
    evidenceCounts: countEvidence(evidence),
    evidence,
    subjects: Array.from(subjectFacts.values()).sort((left, right) => right.effectiveMinutes - left.effectiveMinutes),
  };
}

async function listEvidenceReceipts(
  actorId: string,
  sessionIds: string[],
): Promise<StudySessionEvidenceReceiptDto[]> {
  const events = await prisma.auditEvent.findMany({
    where: {
      actorId,
      action: "STUDY_SESSION_EVIDENCE_LINKED",
      entityType: "StudySession",
      entityId: { in: sessionIds },
    },
    orderBy: { createdAt: "asc" },
    select: { metadata: true },
  });
  return events.flatMap((event) => {
    const receipt = parseEvidenceReceipt(event.metadata);
    return receipt ? [receipt] : [];
  });
}

function parseEvidenceReceipt(value: Prisma.JsonValue | null): StudySessionEvidenceReceiptDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (
    (value.evidenceType !== "note" && value.evidenceType !== "mistake" && value.evidenceType !== "retest")
    || typeof value.evidenceId !== "string"
    || typeof value.label !== "string"
  ) return null;
  return {
    evidenceType: value.evidenceType,
    evidenceId: value.evidenceId,
    label: value.label,
  };
}

function countEvidence(
  evidence: StudySessionEvidenceReceiptDto[],
): Record<StudySessionEvidenceTypeDto, number> {
  return evidence.reduce<Record<StudySessionEvidenceTypeDto, number>>(
    (counts, receipt) => ({ ...counts, [receipt.evidenceType]: counts[receipt.evidenceType] + 1 }),
    { note: 0, mistake: 0, retest: 0 },
  );
}
