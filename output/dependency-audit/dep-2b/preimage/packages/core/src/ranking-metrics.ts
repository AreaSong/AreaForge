/**
 * v1.8 排名基础规则。
 *
 * 这里故意只接受可追踪的学习事实（时间戳、有效学习秒数和最低行动标记）。
 * 动机、情绪、复盘正文、笔记/错题内容、附件、AI prompt 和私有任务标题
 * 不在类型和运行时白名单内，因此不能意外进入分数。
 */

export const PERSONAL_GROWTH_SCORE_VERSION = "personal-growth-v1" as const;
export const PRIVATE_CHALLENGE_SCORE_VERSION = "private-challenge-v1" as const;
export const RANKING_ANTICHEAT_VERSION = "ranking-anticheat-v1" as const;

export const MAX_SESSION_SECONDS = 12 * 60 * 60;
export const MAX_DAILY_EFFECTIVE_SECONDS = 16 * 60 * 60;
export const MAX_WINDOW_DAYS = 366;
export const MAX_SESSION_INPUTS = 100_000;

export type RankingScoreVersion =
  | typeof PERSONAL_GROWTH_SCORE_VERSION
  | typeof PRIVATE_CHALLENGE_SCORE_VERSION;

export interface RankingWindow {
  /** 以用户时区解释的日期，包含 startDate、不包含 endDate。 */
  startDate: string;
  endDate: string;
}

/**
 * 可进入排名计算的最小事实集合。
 *
 * `id` 是不透明的源记录标识，只用于去重和解释异常，不参与分数。
 */
export interface RankingSessionInput {
  id: string;
  startedAt: Date | string;
  endedAt: Date | string;
  effectiveSeconds: number;
  minimumActionCompleted?: boolean;
}

export type RankingAnomalyCode =
  | "duplicate_session"
  | "overlapping_session"
  | "outside_window"
  | "invalid_interval"
  | "duration_exceeds_limit"
  | "effective_seconds_exceeds_elapsed"
  | "zero_effective_seconds"
  | "daily_effective_cap";

export type RankingAnomalyWindow = "baseline" | "current" | "challenge" | "outside";

export interface RankingAnomaly {
  code: RankingAnomalyCode;
  window: RankingAnomalyWindow;
  sessionId?: string;
  detail: string;
}

export interface RankingAggregate {
  effectiveSeconds: number;
  effectiveMinutes: number;
  activeDays: number;
  minimumActionDays: number;
  eligibleSessionCount: number;
  windowDays: number;
}

export type GrowthMetricKey = "effective_minutes" | "active_days" | "minimum_action_days";

export interface GrowthScoreComponent {
  key: GrowthMetricKey;
  label: string;
  weight: number;
  baselineValue: number;
  currentValue: number;
  score: number;
  explanation: string;
}

export interface PersonalGrowthScoreInput {
  timezone: string;
  baselineWindow: RankingWindow;
  currentWindow: RankingWindow;
  sessions: readonly RankingSessionInput[];
}

export interface PersonalGrowthScore {
  kind: "personal_growth";
  scoreVersion: typeof PERSONAL_GROWTH_SCORE_VERSION;
  score: number;
  timezone: string;
  baselineWindow: RankingWindow;
  currentWindow: RankingWindow;
  baseline: RankingAggregate;
  current: RankingAggregate;
  components: readonly GrowthScoreComponent[];
  anomalies: readonly RankingAnomaly[];
  explanation: string;
}

export interface PrivateChallengeScoreInput {
  timezone: string;
  window: RankingWindow;
  /** 挑战创建时冻结的每日目标，不是用户私有任务标题或内容。 */
  targetEffectiveMinutesPerDay: number;
  sessions: readonly RankingSessionInput[];
}

export interface PrivateChallengeScore {
  kind: "private_challenge";
  scoreVersion: typeof PRIVATE_CHALLENGE_SCORE_VERSION;
  score: number;
  timezone: string;
  window: RankingWindow;
  targetEffectiveMinutesPerDay: number;
  aggregate: RankingAggregate;
  components: readonly GrowthScoreComponent[];
  anomalies: readonly RankingAnomaly[];
  explanation: string;
}

export interface PrivateChallengeScoreEntry {
  /** 不透明参与者键；姓名、昵称、邮箱等展示字段不能作为 score 输入。 */
  participantKey: string;
  score: number;
}

export interface RankedPrivateChallengeScoreEntry extends PrivateChallengeScoreEntry {
  /** 采用竞赛排名：并列占用同一名次，下一个名次跳过并列数量。 */
  rank: number;
  tieGroup: number;
  tied: boolean;
}

/**
 * 纯规则反作弊结果。它只根据排名计算已经发现的异常作出确定性判定，
 * 不读取学习正文，也不调用模型或外部服务。REVIEW 只表示需要人工申诉
 * 或复核，不会直接修改学习源事实。
 */
export type RankingAntiCheatStatus = "CLEAR" | "REVIEW" | "EXCLUDED";

export interface RankingAntiCheatInput {
  anomalies: readonly RankingAnomaly[];
}

export interface RankingAntiCheatDecision {
  version: typeof RANKING_ANTICHEAT_VERSION;
  status: RankingAntiCheatStatus;
  eligible: boolean;
  isSuspicious: boolean;
  shouldExclude: boolean;
  reasonCodes: readonly RankingAnomalyCode[];
  explanation: string;
}

export type RankingInputErrorCode =
  | "INPUT_NOT_OBJECT"
  | "INPUT_FIELD_NOT_ALLOWED"
  | "SENSITIVE_FIELD_FORBIDDEN"
  | "TIMEZONE_INVALID"
  | "WINDOW_INVALID"
  | "WINDOW_TOO_LARGE"
  | "WINDOW_OVERLAP"
  | "WINDOW_ORDER_INVALID"
  | "SESSION_INVALID"
  | "SESSION_TIMESTAMP_INVALID"
  | "SESSION_TIMESTAMP_TIMEZONE_REQUIRED"
  | "SESSION_NUMBER_INVALID"
  | "SESSION_BOOLEAN_INVALID"
  | "TARGET_INVALID"
  | "PARTICIPANT_INVALID"
  | "PARTICIPANT_DUPLICATE"
  | "SCORE_INVALID";

export class RankingInputError extends Error {
  readonly code: RankingInputErrorCode;

  constructor(code: RankingInputErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "RankingInputError";
    this.code = code;
  }
}

const PERSONAL_ROOT_KEYS = new Set(["timezone", "baselineWindow", "currentWindow", "sessions"]);
const CHALLENGE_ROOT_KEYS = new Set(["timezone", "window", "targetEffectiveMinutesPerDay", "sessions"]);
const WINDOW_KEYS = new Set(["startDate", "endDate"]);
const SESSION_KEYS = new Set(["id", "startedAt", "endedAt", "effectiveSeconds", "minimumActionCompleted"]);

const SENSITIVE_FIELD_PATTERN =
  /(motivation|mood|emotion|feeling|reflection|note|mistake|attachment|prompt|private.?task.?title|task.?title|content|body|text)/i;

export function calculatePersonalGrowthScore(input: PersonalGrowthScoreInput): PersonalGrowthScore {
  validatePersonalGrowthScoreInput(input);

  const timezone = validateTimezone(input.timezone);
  const baselineWindow = validateWindow(input.baselineWindow);
  const currentWindow = validateWindow(input.currentWindow);
  validateComparableWindows(baselineWindow, currentWindow);

  const { baseline, current, anomalies } = aggregatePersonalWindows({
    timezone,
    baselineWindow,
    currentWindow,
    sessions: input.sessions,
  });
  const components = buildGrowthComponents(baseline, current);
  const score = weightedScore(components);

  return {
    kind: "personal_growth",
    scoreVersion: PERSONAL_GROWTH_SCORE_VERSION,
    score,
    timezone,
    baselineWindow,
    currentWindow,
    baseline,
    current,
    components,
    anomalies,
    explanation: buildPersonalExplanation(score, components, anomalies),
  };
}

/** 同一规则的语义别名，便于调用方按“指数”或“分数”命名。 */
export const calculatePersonalGrowthIndex = calculatePersonalGrowthScore;

export function calculatePrivateChallengeScore(input: PrivateChallengeScoreInput): PrivateChallengeScore {
  validatePrivateChallengeScoreInput(input);

  const timezone = validateTimezone(input.timezone);
  const window = validateWindow(input.window);
  const targetMinutes = validateTargetMinutes(input.targetEffectiveMinutesPerDay);
  const { aggregate, anomalies } = aggregateSingleWindow({
    timezone,
    window,
    windowLabel: "challenge",
    sessions: input.sessions,
  });
  const targetSeconds = targetMinutes * 60 * aggregate.windowDays;
  const volumeScore = targetSeconds === 0 ? 0 : clampScore((aggregate.effectiveSeconds / targetSeconds) * 100);
  const consistencyScore = clampScore((aggregate.activeDays / aggregate.windowDays) * 100);
  const actionScore = clampScore((aggregate.minimumActionDays / aggregate.windowDays) * 100);
  const components: readonly GrowthScoreComponent[] = [
    {
      key: "effective_minutes",
      label: "有效学习时长",
      weight: 0.5,
      baselineValue: targetMinutes * aggregate.windowDays,
      currentValue: aggregate.effectiveMinutes,
      score: volumeScore,
      explanation: `达到挑战目标的 ${formatPercent(volumeScore)}。`,
    },
    {
      key: "active_days",
      label: "有效学习天数",
      weight: 0.3,
      baselineValue: aggregate.windowDays,
      currentValue: aggregate.activeDays,
      score: consistencyScore,
      explanation: `覆盖 ${aggregate.activeDays}/${aggregate.windowDays} 个挑战日。`,
    },
    {
      key: "minimum_action_days",
      label: "最低行动天数",
      weight: 0.2,
      baselineValue: aggregate.windowDays,
      currentValue: aggregate.minimumActionDays,
      score: actionScore,
      explanation: `完成最低行动 ${aggregate.minimumActionDays}/${aggregate.windowDays} 天。`,
    },
  ];
  const score = weightedScore(components);

  return {
    kind: "private_challenge",
    scoreVersion: PRIVATE_CHALLENGE_SCORE_VERSION,
    score,
    timezone,
    window,
    targetEffectiveMinutesPerDay: targetMinutes,
    aggregate,
    components,
    anomalies,
    explanation: `私有挑战得分 ${score}/100；${components.map((component) => component.explanation).join("；")}`,
  };
}

/**
 * 对分数计算产出的异常做单一、可重放的资格判定。
 *
 * 致命结构异常（重复、逆序、超长或有效时长超过墙上时长）会排除该条
 * 排名投影；日上限等可解释截断进入 REVIEW；窗口外和零有效时长属于正常
 * 的无贡献事实，不作为作弊指控。未知异常代码按最严格的 EXCLUDED 处理，
 * 保证新规则上线时不会因旧调用方静默放行。
 */
export function evaluateRankingAntiCheat(input: RankingAntiCheatInput): RankingAntiCheatDecision {
  assertObject(input, "ranking anti-cheat input");
  assertAllowedKeys(input, new Set(["anomalies"]), "ranking anti-cheat input");
  if (!Array.isArray(input.anomalies)) {
    throw new RankingInputError("SESSION_INVALID", "anomalies must be an array");
  }
  const knownCodes = new Set<RankingAnomalyCode>([
    "duplicate_session",
    "overlapping_session",
    "outside_window",
    "invalid_interval",
    "duration_exceeds_limit",
    "effective_seconds_exceeds_elapsed",
    "zero_effective_seconds",
    "daily_effective_cap",
  ]);
  const hardCodes = new Set<RankingAnomalyCode>([
    "duplicate_session",
    "overlapping_session",
    "invalid_interval",
    "duration_exceeds_limit",
    "effective_seconds_exceeds_elapsed",
  ]);
  const reviewCodes = new Set<RankingAnomalyCode>(["daily_effective_cap"]);
  const reasonCodes = [...new Set(input.anomalies.map((anomaly) => anomaly?.code))];
  const hasUnknown = reasonCodes.some((code) => !knownCodes.has(code as RankingAnomalyCode));
  const hasHard = reasonCodes.some((code) => hardCodes.has(code as RankingAnomalyCode));
  const hasReview = reasonCodes.some((code) => reviewCodes.has(code as RankingAnomalyCode));
  const status: RankingAntiCheatStatus = hasUnknown || hasHard ? "EXCLUDED" : hasReview ? "REVIEW" : "CLEAR";
  const eligible = status !== "EXCLUDED";
  return {
    version: RANKING_ANTICHEAT_VERSION,
    status,
    eligible,
    isSuspicious: status !== "CLEAR",
    shouldExclude: !eligible,
    reasonCodes: reasonCodes as RankingAnomalyCode[],
    explanation: status === "EXCLUDED"
      ? "检测到无法安全解释的时间事实，已从排名投影排除；可通过申诉请求复核。"
      : status === "REVIEW"
        ? "检测到已按规则截断的异常时长，保留可重建分数并标记为待复核。"
        : "未检测到需要复核的排名异常。",
  };
}

/** 语义别名，便于服务层按“判定”或“评估”命名。 */
export const assessRankingAntiCheat = evaluateRankingAntiCheat;
export const evaluatePrivateChallengeAntiCheat = evaluateRankingAntiCheat;

export function rankPrivateChallengeScores(
  entries: readonly PrivateChallengeScoreEntry[],
): RankedPrivateChallengeScoreEntry[] {
  const seen = new Set<string>();
  const normalized = entries.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new RankingInputError("PARTICIPANT_INVALID", "participant entry must be an object");
    }
    assertAllowedKeys(entry, new Set(["participantKey", "score"]), "participant entry");
    const participantKey = typeof entry.participantKey === "string" ? entry.participantKey.trim() : "";
    if (!participantKey || participantKey.length > 128) {
      throw new RankingInputError("PARTICIPANT_INVALID", "participantKey must be 1-128 characters");
    }
    if (seen.has(participantKey)) {
      throw new RankingInputError("PARTICIPANT_DUPLICATE", `duplicate participantKey: ${participantKey}`);
    }
    seen.add(participantKey);
    if (!Number.isInteger(entry.score) || entry.score < 0 || entry.score > 100) {
      throw new RankingInputError("SCORE_INVALID", "score must be an integer in [0, 100]");
    }
    return { participantKey, score: entry.score };
  });

  normalized.sort((left, right) => right.score - left.score || left.participantKey.localeCompare(right.participantKey));
  const scoreCounts = new Map<number, number>();
  for (const entry of normalized) scoreCounts.set(entry.score, (scoreCounts.get(entry.score) ?? 0) + 1);
  return normalized.map((entry, index) => {
    const previous = normalized[index - 1];
    const tied = (scoreCounts.get(entry.score) ?? 0) > 1;
    const rank = previous != null && previous.score === entry.score ? index : index + 1;
    const tieGroup = normalized.findIndex((candidate) => candidate.score === entry.score) + 1;
    return { ...entry, rank, tieGroup, tied };
  });
}

export function validatePersonalGrowthScoreInput(input: PersonalGrowthScoreInput): void {
  assertAllowedKeys(input, PERSONAL_ROOT_KEYS, "personal growth input");
  assertObject(input.baselineWindow, "baselineWindow");
  assertObject(input.currentWindow, "currentWindow");
  assertAllowedKeys(input.baselineWindow, WINDOW_KEYS, "baselineWindow");
  assertAllowedKeys(input.currentWindow, WINDOW_KEYS, "currentWindow");
  validateSessionList(input.sessions);
}

export function validatePrivateChallengeScoreInput(input: PrivateChallengeScoreInput): void {
  assertAllowedKeys(input, CHALLENGE_ROOT_KEYS, "private challenge input");
  assertObject(input.window, "window");
  assertAllowedKeys(input.window, WINDOW_KEYS, "window");
  validateSessionList(input.sessions);
}

function validateSessionList(sessions: readonly RankingSessionInput[]): void {
  if (!Array.isArray(sessions) || sessions.length > MAX_SESSION_INPUTS) {
    throw new RankingInputError("SESSION_INVALID", `sessions must contain at most ${MAX_SESSION_INPUTS} records`);
  }
  for (const session of sessions) {
    assertObject(session, "session");
    assertAllowedKeys(session, SESSION_KEYS, "session");
    if (typeof session.id !== "string" || !session.id.trim() || session.id.trim().length > 128) {
      throw new RankingInputError("SESSION_INVALID", "session.id must be 1-128 non-whitespace characters");
    }
    if (typeof session.effectiveSeconds !== "number" || !Number.isFinite(session.effectiveSeconds) || session.effectiveSeconds < 0 || !Number.isInteger(session.effectiveSeconds)) {
      throw new RankingInputError("SESSION_NUMBER_INVALID", "effectiveSeconds must be a finite non-negative integer");
    }
    if (session.minimumActionCompleted !== undefined && typeof session.minimumActionCompleted !== "boolean") {
      throw new RankingInputError("SESSION_BOOLEAN_INVALID", "minimumActionCompleted must be boolean when provided");
    }
  }
}

function aggregatePersonalWindows(input: {
  timezone: string;
  baselineWindow: RankingWindow;
  currentWindow: RankingWindow;
  sessions: readonly RankingSessionInput[];
}): { baseline: RankingAggregate; current: RankingAggregate; anomalies: RankingAnomaly[] } {
  const baselineRecords: RankingSessionInput[] = [];
  const currentRecords: RankingSessionInput[] = [];
  const anomalies: RankingAnomaly[] = [];
  const duplicateIds = findDuplicateIds(input.sessions);

  for (const session of canonicalizeSessions(input.sessions)) {
    const sessionId = session.id.trim();
    if (duplicateIds.has(sessionId)) {
      anomalies.push({
        code: "duplicate_session",
        window: "outside",
        sessionId,
        detail: "重复 session id 全部排除，避免重复计分。",
      });
      continue;
    }
    const startedAt = parseTimestamp(session.startedAt, "startedAt");
    const endedAt = parseTimestamp(session.endedAt, "endedAt");
    const startedDate = localDate(startedAt, input.timezone);
    const endedDate = localDate(endedAt, input.timezone);
    const baselineMatch = isWithinWindow(startedDate, endedDate, input.baselineWindow);
    const currentMatch = isWithinWindow(startedDate, endedDate, input.currentWindow);
    if (!baselineMatch && !currentMatch) {
      anomalies.push({ code: "outside_window", window: "outside", sessionId, detail: "session 不在基线或当前窗口内。" });
      continue;
    }
    const target = baselineMatch ? baselineRecords : currentRecords;
    const label: RankingAnomalyWindow = baselineMatch ? "baseline" : "current";
    const sessionAnomalies = validateSessionDuration(session, startedAt, endedAt, label, sessionId);
    if (sessionAnomalies.length > 0) {
      anomalies.push(...sessionAnomalies);
      continue;
    }
    target.push(session);
  }

  const baselineNonOverlapping = excludeOverlappingSessions(baselineRecords, "baseline");
  const currentNonOverlapping = excludeOverlappingSessions(currentRecords, "current");
  const baselineResult = aggregateSessions(baselineNonOverlapping.sessions, input.timezone, input.baselineWindow, "baseline");
  const currentResult = aggregateSessions(currentNonOverlapping.sessions, input.timezone, input.currentWindow, "current");
  return {
    baseline: baselineResult.aggregate,
    current: currentResult.aggregate,
    anomalies: [
      ...anomalies,
      ...baselineNonOverlapping.anomalies,
      ...currentNonOverlapping.anomalies,
      ...baselineResult.anomalies,
      ...currentResult.anomalies,
    ],
  };
}

function aggregateSingleWindow(input: {
  timezone: string;
  window: RankingWindow;
  windowLabel: "challenge";
  sessions: readonly RankingSessionInput[];
}): { aggregate: RankingAggregate; anomalies: RankingAnomaly[] } {
  const accepted: RankingSessionInput[] = [];
  const anomalies: RankingAnomaly[] = [];
  const duplicateIds = findDuplicateIds(input.sessions);
  for (const session of canonicalizeSessions(input.sessions)) {
    const sessionId = session.id.trim();
    if (duplicateIds.has(sessionId)) {
      anomalies.push({ code: "duplicate_session", window: input.windowLabel, sessionId, detail: "重复 session id 全部排除，避免重复计分。" });
      continue;
    }
    const startedAt = parseTimestamp(session.startedAt, "startedAt");
    const endedAt = parseTimestamp(session.endedAt, "endedAt");
    const startedDate = localDate(startedAt, input.timezone);
    const endedDate = localDate(endedAt, input.timezone);
    if (!isWithinWindow(startedDate, endedDate, input.window)) {
      anomalies.push({ code: "outside_window", window: input.windowLabel, sessionId, detail: "session 不在挑战窗口内。" });
      continue;
    }
    const sessionAnomalies = validateSessionDuration(session, startedAt, endedAt, input.windowLabel, sessionId);
    if (sessionAnomalies.length > 0) {
      anomalies.push(...sessionAnomalies);
      continue;
    }
    accepted.push(session);
  }
  const nonOverlapping = excludeOverlappingSessions(accepted, input.windowLabel);
  const result = aggregateSessions(nonOverlapping.sessions, input.timezone, input.window, input.windowLabel);
  return { aggregate: result.aggregate, anomalies: [...anomalies, ...nonOverlapping.anomalies, ...result.anomalies] };
}

function excludeOverlappingSessions(
  sessions: readonly RankingSessionInput[],
  window: RankingAnomalyWindow,
): { sessions: RankingSessionInput[]; anomalies: RankingAnomaly[] } {
  const accepted: RankingSessionInput[] = [];
  const anomalies: RankingAnomaly[] = [];
  let previousEnd = Number.NEGATIVE_INFINITY;
  for (const session of sessions) {
    const startedAt = parseTimestamp(session.startedAt, "startedAt");
    const endedAt = parseTimestamp(session.endedAt, "endedAt");
    if (startedAt.getTime() < previousEnd) {
      anomalies.push({
        code: "overlapping_session",
        window,
        sessionId: session.id.trim(),
        detail: "重叠 session 不重复计分，后进入的 session 已排除。",
      });
      continue;
    }
    accepted.push(session);
    previousEnd = Math.max(previousEnd, endedAt.getTime());
  }
  return { sessions: accepted, anomalies };
}

function validateSessionDuration(
  session: RankingSessionInput,
  startedAt: Date,
  endedAt: Date,
  window: RankingAnomalyWindow,
  sessionId: string,
): RankingAnomaly[] {
  const elapsedSeconds = (endedAt.getTime() - startedAt.getTime()) / 1000;
  if (elapsedSeconds <= 0) {
    return [{ code: "invalid_interval", window, sessionId, detail: "endedAt 必须晚于 startedAt。" }];
  }
  if (elapsedSeconds > MAX_SESSION_SECONDS) {
    return [{ code: "duration_exceeds_limit", window, sessionId, detail: `单次 session 不得超过 ${MAX_SESSION_SECONDS / 3600} 小时。` }];
  }
  if (session.effectiveSeconds > elapsedSeconds) {
    return [{ code: "effective_seconds_exceeds_elapsed", window, sessionId, detail: "有效秒数不能大于墙上时长。" }];
  }
  if (session.effectiveSeconds === 0) {
    return [{ code: "zero_effective_seconds", window, sessionId, detail: "零有效时长不产生排名分数。" }];
  }
  return [];
}

function aggregateSessions(
  sessions: readonly RankingSessionInput[],
  timezone: string,
  window: RankingWindow,
  windowLabel: RankingAnomalyWindow,
): { aggregate: RankingAggregate; anomalies: RankingAnomaly[] } {
  const byDay = new Map<string, { effectiveSeconds: number; minimumActionCompleted: boolean; sessionCount: number }>();
  for (const session of sessions) {
    const date = localDate(parseTimestamp(session.startedAt, "startedAt"), timezone);
    const entry = byDay.get(date) ?? { effectiveSeconds: 0, minimumActionCompleted: false, sessionCount: 0 };
    entry.effectiveSeconds += session.effectiveSeconds;
    entry.minimumActionCompleted = entry.minimumActionCompleted || session.minimumActionCompleted === true;
    entry.sessionCount += 1;
    byDay.set(date, entry);
  }
  const anomalies: RankingAnomaly[] = [];
  let effectiveSeconds = 0;
  let activeDays = 0;
  let minimumActionDays = 0;
  let eligibleSessionCount = 0;
  for (const date of [...byDay.keys()].sort()) {
    const day = byDay.get(date);
    if (!day) continue;
    const cappedSeconds = Math.min(day.effectiveSeconds, MAX_DAILY_EFFECTIVE_SECONDS);
    if (cappedSeconds < day.effectiveSeconds) {
      anomalies.push({
        code: "daily_effective_cap",
        window: windowLabel,
        detail: `${date} 有效时长超过 ${MAX_DAILY_EFFECTIVE_SECONDS / 3600} 小时，按上限计分。`,
      });
    }
    effectiveSeconds += cappedSeconds;
    activeDays += cappedSeconds > 0 ? 1 : 0;
    minimumActionDays += cappedSeconds > 0 && day.minimumActionCompleted ? 1 : 0;
    eligibleSessionCount += day.sessionCount;
  }
  return {
    aggregate: {
      effectiveSeconds,
      effectiveMinutes: Math.round(effectiveSeconds / 60),
      activeDays,
      minimumActionDays,
      eligibleSessionCount,
      windowDays: countWindowDays(window),
    },
    anomalies,
  };
}

function buildGrowthComponents(baseline: RankingAggregate, current: RankingAggregate): readonly GrowthScoreComponent[] {
  const baselineEffectivePerDay = baseline.effectiveSeconds / baseline.windowDays;
  const currentEffectivePerDay = current.effectiveSeconds / current.windowDays;
  const baselineActiveRate = baseline.activeDays / baseline.windowDays;
  const currentActiveRate = current.activeDays / current.windowDays;
  const baselineActionRate = baseline.minimumActionDays / baseline.windowDays;
  const currentActionRate = current.minimumActionDays / current.windowDays;
  return [
    {
      key: "effective_minutes",
      label: "有效学习时长",
      weight: 0.45,
      baselineValue: Math.round(baselineEffectivePerDay / 60),
      currentValue: Math.round(currentEffectivePerDay / 60),
      score: growthMetricScore(currentEffectivePerDay, baselineEffectivePerDay),
      explanation: growthExplanation("有效学习时长", currentEffectivePerDay / 60, baselineEffectivePerDay / 60, "分钟/天"),
    },
    {
      key: "active_days",
      label: "有效学习天数",
      weight: 0.35,
      baselineValue: baselineActiveRate,
      currentValue: currentActiveRate,
      score: growthMetricScore(currentActiveRate, baselineActiveRate),
      explanation: growthExplanation("有效学习日覆盖", currentActiveRate, baselineActiveRate, "比例"),
    },
    {
      key: "minimum_action_days",
      label: "最低行动天数",
      weight: 0.2,
      baselineValue: baselineActionRate,
      currentValue: currentActionRate,
      score: growthMetricScore(currentActionRate, baselineActionRate),
      explanation: growthExplanation("最低行动覆盖", currentActionRate, baselineActionRate, "比例"),
    },
  ];
}

function growthMetricScore(current: number, baseline: number): number {
  if (baseline === 0) return current === 0 ? 50 : 100;
  return clampScore(50 + ((current - baseline) / baseline) * 50);
}

function weightedScore(components: readonly GrowthScoreComponent[]): number {
  return clampScore(components.reduce((sum, component) => sum + component.score * component.weight, 0));
}

function buildPersonalExplanation(score: number, components: readonly GrowthScoreComponent[], anomalies: readonly RankingAnomaly[]): string {
  const anomalyText = anomalies.length > 0 ? ` 已排除或截断 ${anomalies.length} 条异常输入。` : " 未发现异常输入。";
  return `个人成长指数 ${score}/100；${components.map((component) => component.explanation).join("；")}。${anomalyText}`;
}

function growthExplanation(label: string, current: number, baseline: number, unit: string): string {
  if (baseline === 0) {
    return current === 0 ? `${label}基线与当前均为 0。` : `${label}从无到有，当前 ${formatMetric(current, unit)}。`;
  }
  const deltaPercent = Math.round(((current - baseline) / baseline) * 100);
  if (deltaPercent === 0) {
    return `${label}保持不变（基线 ${formatMetric(baseline, unit)}，当前 ${formatMetric(current, unit)}）。`;
  }
  const direction = deltaPercent > 0 ? "增加" : "减少";
  return `${label}${direction} ${Math.abs(deltaPercent)}%（基线 ${formatMetric(baseline, unit)}，当前 ${formatMetric(current, unit)}）。`;
}

function formatMetric(value: number, unit: string): string {
  if (unit === "比例") return formatPercent(value * 100);
  return `${Math.round(value)} ${unit}`;
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function validateTimezone(value: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RankingInputError("TIMEZONE_INVALID", "timezone must be a non-empty IANA timezone");
  }
  const timezone = value.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new RankingInputError("TIMEZONE_INVALID", `unknown IANA timezone: ${timezone}`);
  }
  return timezone;
}

function validateWindow(input: RankingWindow): RankingWindow {
  assertObject(input, "window");
  const startDate = validateDateOnly(input.startDate, "window.startDate");
  const endDate = validateDateOnly(input.endDate, "window.endDate");
  const days = dateOnlyDifference(startDate, endDate);
  if (days <= 0) throw new RankingInputError("WINDOW_INVALID", "window must have startDate before endDate");
  if (days > MAX_WINDOW_DAYS) throw new RankingInputError("WINDOW_TOO_LARGE", `window must be <= ${MAX_WINDOW_DAYS} days`);
  return { startDate, endDate };
}

function validateComparableWindows(baseline: RankingWindow, current: RankingWindow): void {
  const baselineDays = countWindowDays(baseline);
  const currentDays = countWindowDays(current);
  if (baselineDays !== currentDays) {
    throw new RankingInputError("WINDOW_INVALID", "baseline and current windows must have equal day counts");
  }
  if (baseline.endDate > current.startDate) {
    throw new RankingInputError("WINDOW_OVERLAP", "baseline and current windows must not overlap");
  }
  if (baseline.startDate >= current.startDate) {
    throw new RankingInputError("WINDOW_ORDER_INVALID", "baseline window must precede current window");
  }
}

function validateTargetMinutes(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 24 * 60) {
    throw new RankingInputError("TARGET_INVALID", "targetEffectiveMinutesPerDay must be an integer in [1, 1440]");
  }
  return value;
}

function validateDateOnly(value: string, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RankingInputError("WINDOW_INVALID", `${field} must be YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RankingInputError("WINDOW_INVALID", `${field} is not a calendar date`);
  }
  return value;
}

function countWindowDays(window: RankingWindow): number {
  return dateOnlyDifference(window.startDate, window.endDate);
}

function dateOnlyDifference(startDate: string, endDate: string): number {
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000);
}

function parseTimestamp(value: Date | string, field: string): Date {
  if (!(value instanceof Date) && typeof value !== "string") {
    throw new RankingInputError("SESSION_TIMESTAMP_INVALID", `${field} must be an ISO timestamp or Date`);
  }
  if (typeof value === "string" && !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new RankingInputError("SESSION_TIMESTAMP_TIMEZONE_REQUIRED", `${field} must include an explicit timezone`);
  }
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new RankingInputError("SESSION_TIMESTAMP_INVALID", `${field} is not a valid timestamp`);
  }
  return parsed;
}

function localDate(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new RankingInputError("TIMEZONE_INVALID", "could not derive local date");
  return `${year}-${month}-${day}`;
}

function isWithinWindow(startedDate: string, endedDate: string, window: RankingWindow): boolean {
  return startedDate >= window.startDate && startedDate < window.endDate && endedDate >= window.startDate && endedDate < window.endDate;
}

function findDuplicateIds(sessions: readonly RankingSessionInput[]): Set<string> {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const id = session.id.trim();
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
}

function canonicalizeSessions(sessions: readonly RankingSessionInput[]): RankingSessionInput[] {
  return [...sessions].sort((left, right) => {
    return (
      left.id.trim().localeCompare(right.id.trim()) ||
      timestampSortKey(left.startedAt).localeCompare(timestampSortKey(right.startedAt)) ||
      timestampSortKey(left.endedAt).localeCompare(timestampSortKey(right.endedAt)) ||
      left.effectiveSeconds - right.effectiveSeconds
    );
  });
}

function timestampSortKey(value: Date | string): string {
  return value instanceof Date ? String(value.getTime()).padStart(16, "0") : value;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function assertObject(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RankingInputError("INPUT_NOT_OBJECT", `${field} must be an object`);
  }
}

function assertAllowedKeys(value: unknown, allowed: ReadonlySet<string>, field: string): void {
  assertObject(value, field);
  for (const key of Object.keys(value)) {
    if (SENSITIVE_FIELD_PATTERN.test(key)) {
      throw new RankingInputError("SENSITIVE_FIELD_FORBIDDEN", `${field}.${key} cannot enter ranking score`);
    }
    if (!allowed.has(key)) {
      throw new RankingInputError("INPUT_FIELD_NOT_ALLOWED", `${field}.${key} is not allowed`);
    }
  }
}
