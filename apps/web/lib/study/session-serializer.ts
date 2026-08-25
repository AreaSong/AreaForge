import type { Prisma } from "@areaforge/db";
import { fromDbTaskStatus } from "./task-serializer";
import type {
  StudySessionDto,
  StudySessionKnowledgePointDto,
  StudySessionLowReasonDto,
  StudySessionStartSourceDto,
} from "@/lib/contracts";

type DbTaskStatus = "TODO" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "DEFERRED";
type DbStudySessionStatus = "RUNNING" | "PAUSED" | "CLOSING" | "COMPLETED" | "CANCELED";
type DbStudySessionActivityKind = "STUDY" | "REVIEW" | "TEST";
type DbStudySessionActivityMode = "FREE_STUDY" | "KNOWLEDGE_REVIEW" | "RETEST" | "SIMULATION";

const DEVICE_PRESENCE_STALE_MS = 90_000;

export interface SerializableSessionRecord {
  id: string;
  subjectId: string;
  activityKind: DbStudySessionActivityKind;
  activityMode: DbStudySessionActivityMode;
  reviewScheduleId: string | null;
  knowledgeRetestId: string | null;
  simulationExamId: string | null;
  taskId: string | null;
  syllabusNodeId: string | null;
  status: DbStudySessionStatus;
  startedAt: Date;
  updatedAt: Date;
  pausedAt: Date | null;
  endedAt: Date | null;
  accumulatedPauseSeconds: number;
  effectiveMinutes: number;
  qualityScore: number | null;
  isEffective: boolean | null;
  understandingLevel: string | null;
  minimalOutput: string | null;
  nextAction: string | null;
  producedNote: boolean;
  producedMistake: boolean;
  isLowConversion: boolean | null;
  antiFakeReason: string | null;
  requiredOutput: string | null;
  closeoutVersion: number;
  note: string | null;
  goalMinutes?: number | null;
  startSource?: StudySessionStartSourceDto | null;
  clientDeviceId?: string | null;
  clientDeviceLabel?: string | null;
  lastHeartbeatAt?: Date | null;
  devicePresences?: Array<{
    deviceId: string;
    deviceLabel: string | null;
    lastSeenAt: Date;
  }>;
  knowledgeLinks?: Array<{ knowledgePoint: { id: string; title: string; masteryState: string } }>;
  closeout?: {
    lowReasons: Prisma.JsonValue | null;
    focusLevel: number | null;
    energyLevel: number | null;
    nextDisposition: string | null;
  } | null;
  subject: { name: string };
  task?: { title: string; status: DbTaskStatus } | null;
  syllabusNode?: { title: string } | null;
}

export function serializeSession(session: SerializableSessionRecord, now = new Date()): StudySessionDto {
  return {
    id: session.id,
    subjectId: session.subjectId,
    subjectName: session.subject.name,
    activityKind: session.activityKind,
    activityMode: session.activityMode,
    reviewScheduleId: session.reviewScheduleId,
    knowledgeRetestId: session.knowledgeRetestId,
    simulationExamId: session.simulationExamId,
    taskId: session.taskId,
    taskTitle: session.task?.title ?? null,
    taskStatus: session.task ? fromDbTaskStatus(session.task.status) : null,
    syllabusNodeId: session.syllabusNodeId,
    syllabusNodeTitle: session.syllabusNode?.title ?? null,
    knowledgePoints: (session.knowledgeLinks ?? []).map(({ knowledgePoint }) => ({
      id: knowledgePoint.id,
      title: knowledgePoint.title,
      masteryState: knowledgePoint.masteryState as StudySessionKnowledgePointDto["masteryState"],
    })),
    status: fromDbSessionStatus(session.status),
    startedAt: session.startedAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
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
    goalMinutes: session.goalMinutes ?? null,
    startSource: session.startSource ?? null,
    clientDeviceId: session.clientDeviceId ?? null,
    clientDeviceLabel: session.clientDeviceLabel ?? null,
    lastHeartbeatAt: session.lastHeartbeatAt?.toISOString() ?? null,
    devicePresences: isActiveStatus(session.status)
      ? (session.devicePresences ?? [])
        .filter((presence) => now.getTime() - presence.lastSeenAt.getTime() <= DEVICE_PRESENCE_STALE_MS)
        .sort((left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime())
        .map((presence) => ({
          deviceId: presence.deviceId,
          deviceLabel: presence.deviceLabel ?? "其他设备",
          lastSeenAt: presence.lastSeenAt.toISOString(),
          isCurrentDevice: presence.deviceId === session.clientDeviceId,
        }))
      : [],
    lowReasons: parseLowReasons(session.closeout?.lowReasons),
    focusLevel: session.closeout?.focusLevel ?? null,
    energyLevel: session.closeout?.energyLevel ?? null,
    nextDisposition: session.closeout?.nextDisposition ?? null,
  };
}

export function normalizeDeviceId(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return /^[A-Za-z0-9:_-]{8,100}$/.test(normalized) ? normalized : null;
}

export function normalizeDeviceLabel(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized.length > 0 ? normalized.slice(0, 80) : null;
}

function parseLowReasons(value: Prisma.JsonValue | null | undefined): StudySessionLowReasonDto[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<StudySessionLowReasonDto>([
    "NOT_UNDERSTOOD",
    "DISTRACTED",
    "MATERIAL_BLOCKED",
    "FATIGUE",
    "METHOD_MISMATCH",
    "TIME_FRAGMENTED",
    "OTHER",
  ]);
  return value.filter((item): item is StudySessionLowReasonDto =>
    typeof item === "string" && allowed.has(item as StudySessionLowReasonDto));
}

function fromDbSessionStatus(status: DbStudySessionStatus): StudySessionDto["status"] {
  return status.toLowerCase() as StudySessionDto["status"];
}

function isActiveStatus(status: DbStudySessionStatus): boolean {
  return status === "RUNNING" || status === "PAUSED" || status === "CLOSING";
}
