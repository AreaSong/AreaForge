import { getBrowserStoragePort } from "@/lib/client/storage-port";
import type { StudySessionDto, StudySessionLowReasonDto } from "@/lib/contracts";
import type {
  TaskDisposition,
  UnderstandingLevel,
} from "@/components/focus-session-panels";

const DRAFT_PREFIX = "areaforge.focus.closeout.";
const DRAFT_VERSION = 3;
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export type FocusPhase = "focus" | "closeout" | "low-conversion" | "evidence" | "complete";

export interface FocusCloseoutDraft {
  qualityScore: string;
  isEffective: string;
  understandingLevel: UnderstandingLevel;
  lowReasons: StudySessionLowReasonDto[];
  focusLevel: string;
  energyLevel: string;
  minimalOutput: string;
  nextAction: string;
  nextDisposition: string;
  note: string;
  taskDisposition: TaskDisposition;
}

export type FocusCloseoutSubmission =
  | { ok: false; error: string }
  | {
    ok: true;
    body: {
      mode: "complete";
      qualityScore: number;
      isEffective: boolean;
      understandingLevel: UnderstandingLevel;
      lowReasons: StudySessionLowReasonDto[];
      focusLevel: number;
      energyLevel: number;
      minimalOutput: string;
      nextAction: string;
      nextDisposition: string;
      producedNote: false;
      producedMistake: false;
      note: string;
      completeTask: boolean;
    };
  };

export function focusDraftKey(userId: string, sessionId: string) {
  return `${DRAFT_PREFIX}v3.${userId}.${sessionId}`;
}

export function readFocusDraft(userId: string, sessionId: string) {
  if (typeof window === "undefined") return null;
  const key = focusDraftKey(userId, sessionId);
  const raw = readFocusLocalStorage(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      version?: number;
      userId?: string;
      sessionId?: string;
      updatedAt?: number;
      qualityScore?: string;
      isEffective?: string;
      understandingLevel?: UnderstandingLevel;
      lowReasons?: StudySessionLowReasonDto[];
      focusLevel?: string;
      energyLevel?: string;
      minimalOutput?: string;
      nextAction?: string;
      nextDisposition?: string;
      note?: string;
      taskDisposition?: TaskDisposition;
    };
    if (
      parsed.version !== DRAFT_VERSION
      || parsed.userId !== userId
      || parsed.sessionId !== sessionId
      || typeof parsed.updatedAt !== "number"
      || Date.now() - parsed.updatedAt > DRAFT_TTL_MS
    ) {
      removeFocusLocalStorage(key);
      return null;
    }
    return parsed;
  } catch {
    removeFocusLocalStorage(key);
    return null;
  }
}

export function defaultFocusCloseoutDraft(): FocusCloseoutDraft {
  return {
    qualityScore: "3",
    isEffective: "true",
    understandingLevel: "基本理解",
    lowReasons: [],
    focusLevel: "3",
    energyLevel: "3",
    minimalOutput: "",
    nextAction: "继续推进",
    nextDisposition: "",
    note: "",
    taskDisposition: "continue",
  };
}

export function mergeFocusCloseoutDraft(
  saved: ReturnType<typeof readFocusDraft>,
): FocusCloseoutDraft {
  const fallback = defaultFocusCloseoutDraft();
  return {
    qualityScore: saved?.qualityScore ?? fallback.qualityScore,
    isEffective: saved?.isEffective ?? fallback.isEffective,
    understandingLevel: saved?.understandingLevel ?? fallback.understandingLevel,
    lowReasons: saved?.lowReasons ?? fallback.lowReasons,
    focusLevel: saved?.focusLevel ?? fallback.focusLevel,
    energyLevel: saved?.energyLevel ?? fallback.energyLevel,
    minimalOutput: saved?.minimalOutput ?? fallback.minimalOutput,
    nextAction: saved?.nextAction ?? fallback.nextAction,
    nextDisposition: saved?.nextDisposition ?? fallback.nextDisposition,
    note: saved?.note ?? fallback.note,
    taskDisposition: saved?.taskDisposition ?? fallback.taskDisposition,
  };
}

export function persistFocusDraft(
  userId: string,
  sessionId: string,
  draft: FocusCloseoutDraft,
) {
  writeFocusLocalStorage(focusDraftKey(userId, sessionId), JSON.stringify({
    version: DRAFT_VERSION,
    userId,
    sessionId,
    updatedAt: Date.now(),
    ...draft,
  }));
}

export function removeFocusDraft(userId: string, sessionId: string) {
  removeFocusLocalStorage(focusDraftKey(userId, sessionId));
}

export function migrateFocusDraft(
  userId: string,
  fromSessionId: string,
  toSessionId: string,
  currentDraft: FocusCloseoutDraft,
): void {
  if (fromSessionId === toSessionId) return;
  const savedDraft = readFocusDraft(userId, fromSessionId);
  persistFocusDraft(
    userId,
    toSessionId,
    savedDraft ? mergeFocusCloseoutDraft(savedDraft) : currentDraft,
  );
  removeFocusDraft(userId, fromSessionId);
}

function readFocusLocalStorage(key: string): string | null {
  try {
    return getBrowserStoragePort("local")?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeFocusLocalStorage(key: string, value: string): void {
  try {
    getBrowserStoragePort("local")?.setItem(key, value);
  } catch {
    // IndexedDB remains the primary offline store; drafts are best-effort.
  }
}

function removeFocusLocalStorage(key: string): void {
  try {
    getBrowserStoragePort("local")?.removeItem(key);
  } catch {
    // A blocked storage context should not prevent the closeout flow.
  }
}

export function initialFocusPhase(session: StudySessionDto): FocusPhase {
  if (session.status === "closing") return "closeout";
  if (session.status !== "completed") return "focus";
  return session.isLowConversion ? "low-conversion" : "complete";
}

export function focusPhaseLabel(phase: FocusPhase): string {
  if (phase === "focus") return "专注计时";
  if (phase === "closeout") return "学习收口";
  if (phase === "low-conversion") return "低转化补救";
  if (phase === "evidence") return "证据接力";
  return "完成摘要";
}

export function buildFocusCloseoutSubmission(
  draft: FocusCloseoutDraft,
): FocusCloseoutSubmission {
  const minimalOutput = draft.minimalOutput.trim();
  const nextAction = draft.nextAction.trim();
  if (minimalOutput.length < 4) {
    return { ok: false, error: "请填写至少 4 个字符的真实最小产出，系统不会代填学习事实。" };
  }
  if (!nextAction) {
    return {
      ok: false,
      error: draft.taskDisposition === "blocked"
        ? "请写明阻塞原因和恢复位置。"
        : "请填写下一动作。",
    };
  }
  if (draft.isEffective === "false" && draft.lowReasons.length === 0) {
    return { ok: false, error: "低效学习必须至少选择一个原因，方便后续补充和复盘。" };
  }
  return {
    ok: true,
    body: {
      mode: "complete",
      qualityScore: Number(draft.qualityScore),
      isEffective: draft.isEffective === "true",
      understandingLevel: draft.understandingLevel,
      lowReasons: draft.lowReasons,
      focusLevel: Number(draft.focusLevel),
      energyLevel: Number(draft.energyLevel),
      minimalOutput,
      nextAction,
      nextDisposition: draft.nextDisposition.trim() || nextAction,
      producedNote: false,
      producedMistake: false,
      note: draft.note,
      completeTask: draft.taskDisposition === "complete",
    },
  };
}
