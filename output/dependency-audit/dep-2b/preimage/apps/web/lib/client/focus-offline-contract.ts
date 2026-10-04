import type { StudySessionDto, StudySessionLowReasonDto, StudySessionStartSourceDto } from "@/lib/contracts";

export type FocusOfflineAction = "start" | "pause" | "resume" | "end" | "context";
export type FocusOfflineSyncState = "current" | "pending" | "offline" | "blocked" | "deferred";
export type FocusOfflineConflictResolution = "adopt-server" | "defer" | "abandon";

export interface FocusOfflineCommand {
  id: string;
  userId: string;
  localSessionId: string;
  serverSessionId: string | null;
  action: FocusOfflineAction;
  body: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  state: "pending" | "blocked" | "deferred";
  lastError: string | null;
  conflictSession?: StudySessionDto | null;
  blockedAt?: string | null;
}

export interface FocusOfflineSnapshot {
  userId: string;
  session: StudySessionDto;
  savedAt: string;
  syncState: FocusOfflineSyncState;
  pendingCount: number;
}

export interface LocalFocusSessionInput {
  userId: string;
  subjectId: string;
  subjectName: string;
  taskId?: string | null;
  taskTitle?: string | null;
  syllabusNodeId?: string | null;
  syllabusNodeTitle?: string | null;
  knowledgePoints?: StudySessionDto["knowledgePoints"];
  goalMinutes?: number | null;
  startSource?: StudySessionStartSourceDto;
  clientDeviceId?: string | null;
  clientDeviceLabel?: string | null;
}

export interface FocusOfflineSyncResult {
  state: FocusOfflineSyncState;
  session: StudySessionDto | null;
  pendingCount: number;
}

export interface FocusOfflineConflictRecord {
  command: FocusOfflineCommand;
  localSession: StudySessionDto | null;
  latestSession: StudySessionDto | null;
}

export function isLocalFocusSessionId(id: string): boolean {
  return id.startsWith("local-focus-");
}

export function createFocusStartIdempotencyKey(random = randomId): string {
  return `focus-start-${random()}`;
}

export function createLocalFocusSession(
  input: LocalFocusSessionInput,
  now = new Date(),
  random = randomId,
): StudySessionDto {
  const timestamp = now.toISOString();
  return {
    id: `local-focus-${random()}`,
    subjectId: input.subjectId,
    subjectName: input.subjectName,
    activityKind: "STUDY",
    activityMode: "FREE_STUDY",
    reviewScheduleId: null,
    knowledgeRetestId: null,
    simulationExamId: null,
    taskId: input.taskId ?? null,
    taskTitle: input.taskTitle ?? null,
    taskStatus: null,
    syllabusNodeId: input.syllabusNodeId ?? null,
    syllabusNodeTitle: input.syllabusNodeTitle ?? null,
    knowledgePoints: input.knowledgePoints ?? [],
    status: "running",
    startedAt: timestamp,
    updatedAt: timestamp,
    pausedAt: null,
    endedAt: null,
    accumulatedPauseSeconds: 0,
    effectiveMinutes: 0,
    qualityScore: null,
    isEffective: null,
    understandingLevel: null,
    minimalOutput: null,
    nextAction: null,
    producedNote: false,
    producedMistake: false,
    isLowConversion: null,
    antiFakeReason: null,
    requiredOutput: null,
    closeoutVersion: 1,
    note: null,
    goalMinutes: input.goalMinutes ?? null,
    startSource: input.startSource ?? "SUBJECT_SHORTCUT",
    clientDeviceId: input.clientDeviceId ?? null,
    clientDeviceLabel: input.clientDeviceLabel ?? null,
    lastHeartbeatAt: timestamp,
    lowReasons: [],
    focusLevel: null,
    energyLevel: null,
    nextDisposition: null,
    devicePresences: input.clientDeviceId ? [{
      deviceId: input.clientDeviceId,
      deviceLabel: input.clientDeviceLabel ?? "当前设备",
      lastSeenAt: timestamp,
      isCurrentDevice: true,
    }] : [],
  };
}

export function applyLocalFocusCommand(
  session: StudySessionDto,
  action: Exclude<FocusOfflineAction, "start">,
  body: Record<string, unknown> = {},
  now = new Date(),
): StudySessionDto {
  const timestamp = now.toISOString();
  if (action === "context" && ["running", "paused", "closing"].includes(session.status)) {
    return {
      ...session,
      taskId: stringOrNullOrCurrent(body.taskId, session.taskId),
      taskTitle: stringOrNullOrCurrent(body.taskTitle, session.taskTitle),
      syllabusNodeId: stringOrNullOrCurrent(body.syllabusNodeId, session.syllabusNodeId),
      syllabusNodeTitle: stringOrNullOrCurrent(body.syllabusNodeTitle, session.syllabusNodeTitle),
      knowledgePoints: Array.isArray(body.knowledgePoints)
        ? body.knowledgePoints as StudySessionDto["knowledgePoints"]
        : session.knowledgePoints,
      updatedAt: timestamp,
    };
  }
  if (action === "pause" && session.status === "running") {
    return { ...session, status: "paused", pausedAt: timestamp, updatedAt: timestamp };
  }
  if (action === "resume" && (session.status === "paused" || session.status === "closing")) {
    const pauseOrigin = session.status === "paused" ? session.pausedAt : session.endedAt;
    const pauseSeconds = pauseOrigin
      ? Math.max(0, Math.floor((now.getTime() - new Date(pauseOrigin).getTime()) / 1000))
      : 0;
    return {
      ...session,
      status: "running",
      pausedAt: null,
      endedAt: null,
      accumulatedPauseSeconds: session.accumulatedPauseSeconds + pauseSeconds,
      updatedAt: timestamp,
    };
  }
  if (action === "end" && body.mode === "prepare" && ["running", "paused"].includes(session.status)) {
    const pauseSeconds = session.status === "paused" && session.pausedAt
      ? session.accumulatedPauseSeconds + Math.max(0, Math.floor((now.getTime() - new Date(session.pausedAt).getTime()) / 1000))
      : session.accumulatedPauseSeconds;
    const elapsedSeconds = Math.max(
      0,
      Math.floor((now.getTime() - new Date(session.startedAt).getTime()) / 1000) - pauseSeconds,
    );
    return {
      ...session,
      status: "closing",
      endedAt: timestamp,
      pausedAt: null,
      accumulatedPauseSeconds: pauseSeconds,
      effectiveMinutes: Math.max(0, Math.floor(elapsedSeconds / 60)),
      closeoutVersion: session.closeoutVersion + 1,
      updatedAt: timestamp,
    };
  }
  if (action === "end" && body.mode !== "prepare" && session.status === "closing") {
    const endedAt = session.endedAt ? new Date(session.endedAt) : now;
    const pauseSeconds = session.accumulatedPauseSeconds;
    const elapsedSeconds = Math.max(
      0,
      Math.floor((endedAt.getTime() - new Date(session.startedAt).getTime()) / 1000) - pauseSeconds,
    );
    const isEffective = body.isEffective === true;
    const minimalOutput = typeof body.minimalOutput === "string" ? body.minimalOutput : null;
    const lowReasons = Array.isArray(body.lowReasons)
      ? body.lowReasons.filter((value): value is StudySessionLowReasonDto => isLowReason(value))
      : [];
    return {
      ...session,
      // 本地收口只是提案，最终完成事实仍由服务端确认。
      status: "closing",
      endedAt: endedAt.toISOString(),
      pausedAt: null,
      accumulatedPauseSeconds: pauseSeconds,
      effectiveMinutes: Math.max(0, Math.floor(elapsedSeconds / 60)),
      qualityScore: typeof body.qualityScore === "number" ? body.qualityScore : null,
      isEffective,
      understandingLevel: typeof body.understandingLevel === "string" ? body.understandingLevel : null,
      minimalOutput,
      nextAction: typeof body.nextAction === "string" ? body.nextAction : null,
      producedNote: body.producedNote === true,
      producedMistake: body.producedMistake === true,
      isLowConversion: !isEffective || minimalOutput === null || minimalOutput.trim().length < 4,
      antiFakeReason: !isEffective ? "本地收口标记为低转化，联网后会继续进入补充流程。" : null,
      requiredOutput: !isEffective ? "补充一条可复核的学习产出。" : null,
      note: typeof body.note === "string" ? body.note : null,
      closeoutVersion: session.closeoutVersion + 1,
      lowReasons,
      focusLevel: typeof body.focusLevel === "number" ? body.focusLevel : null,
      energyLevel: typeof body.energyLevel === "number" ? body.energyLevel : null,
      nextDisposition: typeof body.nextDisposition === "string" ? body.nextDisposition : null,
      updatedAt: timestamp,
    };
  }
  return session;
}

export function rebaseFocusCommand(
  action: FocusOfflineAction,
  body: Record<string, unknown>,
  session: Pick<StudySessionDto, "status" | "updatedAt">,
): Record<string, unknown> {
  if (action === "start") return body;
  return { ...body, expectedStatus: session.status, expectedUpdatedAt: session.updatedAt };
}

export function isFocusSyncState(value: unknown): value is FocusOfflineSyncState {
  return value === "current" || value === "pending" || value === "offline" || value === "blocked" || value === "deferred";
}

export function isStudySessionDto(value: unknown): value is StudySessionDto {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<StudySessionDto>;
  return typeof session.id === "string"
    && typeof session.subjectId === "string"
    && typeof session.status === "string";
}

export function isLowReason(value: unknown): value is StudySessionLowReasonDto {
  return value === "NOT_UNDERSTOOD"
    || value === "DISTRACTED"
    || value === "MATERIAL_BLOCKED"
    || value === "FATIGUE"
    || value === "METHOD_MISMATCH"
    || value === "TIME_FRAGMENTED"
    || value === "OTHER";
}

function stringOrNullOrCurrent(value: unknown, current: string | null): string | null {
  return typeof value === "string" ? value : value === null ? null : current;
}

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
