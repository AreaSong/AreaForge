export interface NoteCardMetrics {
  attemptCount: number;
  passRate: number | null;
  avgDurationSeconds: number | null;
  consecutivePassCount: number;
  starRating: number;
  daysSinceReview: number | null;
  isDueToday?: boolean;
  isOverdue?: boolean;
}

export interface MistakeCardMetrics {
  attemptCount: number;
  passRate: number | null;
  avgDurationSeconds: number | null;
  consecutivePassCount: number;
  starRating: number;
  daysSinceReview: number | null;
  isDueToday?: boolean;
  isOverdue?: boolean;
}

export function isNextReviewOverdue(nextReviewAt: string | Date | null | undefined): boolean {
  if (!nextReviewAt) return false;
  const target = new Date(nextReviewAt).getTime();
  if (isNaN(target)) return false;
  return target <= Date.now();
}

export function isNextReviewDueToday(nextReviewAt: string | Date | null | undefined): boolean {
  if (!nextReviewAt) return false;
  const target = new Date(nextReviewAt).getTime();
  if (isNaN(target)) return false;
  const now = Date.now();
  return target > now && target - now <= 24 * 60 * 60 * 1000;
}

/**
 * Calculates days difference between target timestamp and now
 */
export function getDaysAgo(timestamp: string | Date | null | undefined): number | null {
  if (!timestamp) return null;
  const target = new Date(timestamp).getTime();
  if (isNaN(target)) return null;
  const now = Date.now();
  const diffDays = Math.floor((now - target) / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

/**
 * Derive star rating (1-5) from mastery / consecutive passes
 */
export function calculateStarRating(
  masteryStatus: string | null | undefined,
  consecutivePassCount = 0,
): number {
  if (consecutivePassCount >= 4) return 5;
  if (consecutivePassCount === 3) return 4;
  if (consecutivePassCount === 2) return 3;
  if (consecutivePassCount === 1) return 2;

  if (masteryStatus === "understood") return 5;
  if (masteryStatus === "partial") return 3;
  if (masteryStatus === "relearn") return 2;
  if (masteryStatus === "before_exam") return 4;
  if (masteryStatus === "STABLE_MASTERY") return 5;
  if (masteryStatus === "INITIAL_MASTERY") return 4;
  if (masteryStatus === "LEARNING") return 3;
  if (masteryStatus === "NEEDS_RETEST") return 2;
  return 1;
}

/**
 * Micro-Badge Cluster for Note / Flashcard
 */
export function NoteMicroBadgeCluster({ metrics }: { metrics: NoteCardMetrics }) {
  const { attemptCount, passRate, avgDurationSeconds, starRating, daysSinceReview, isDueToday, isOverdue } = metrics;

  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-zinc-400">
      {isOverdue ? (
        <span className="inline-flex items-center gap-1 font-semibold text-rose-400">
          <span className="size-1.5 rounded-full bg-rose-400 shadow-[0_0_6px_rgba(244,63,94,0.8)]" />
          <span>逾期待复习</span>
        </span>
      ) : isDueToday ? (
        <span className="inline-flex items-center gap-1 font-semibold text-amber-400">
          <span className="size-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.8)]" />
          <span>今日到期</span>
        </span>
      ) : daysSinceReview !== null ? (
        <span>{daysSinceReview === 0 ? "今日已复习" : `${daysSinceReview}天前复习`}</span>
      ) : null}
      <span>作答: {attemptCount}次</span>
      {passRate !== null ? (
        <span className={passRate >= 80 ? "text-emerald-400" : passRate >= 60 ? "text-sky-400" : "text-amber-400"}>
          正答: {passRate}%
        </span>
      ) : null}
      {avgDurationSeconds !== null && avgDurationSeconds > 0 ? (
        <span>均耗: {avgDurationSeconds}s</span>
      ) : null}
      <span className="text-amber-300">★ {starRating}星</span>
    </div>
  );
}

/**
 * Micro-Badge Cluster for Mistake Card
 */
export function MistakeMicroBadgeCluster({ metrics }: { metrics: MistakeCardMetrics }) {
  const { attemptCount, passRate, avgDurationSeconds, starRating, daysSinceReview, isDueToday, isOverdue } = metrics;

  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-zinc-400">
      {isOverdue ? (
        <span className="inline-flex items-center gap-1 font-semibold text-rose-400">
          <span className="size-1.5 rounded-full bg-rose-400 shadow-[0_0_6px_rgba(244,63,94,0.8)]" />
          <span>逾期待复习</span>
        </span>
      ) : isDueToday ? (
        <span className="inline-flex items-center gap-1 font-semibold text-amber-400">
          <span className="size-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.8)]" />
          <span>今日到期</span>
        </span>
      ) : daysSinceReview !== null ? (
        <span>{daysSinceReview === 0 ? "今日已复习" : `${daysSinceReview}天前复习`}</span>
      ) : null}
      <span>作答: {attemptCount}次</span>
      {passRate !== null ? (
        <span className={passRate >= 80 ? "text-emerald-400" : passRate >= 50 ? "text-amber-400" : "text-rose-400"}>
          正答: {passRate}%
        </span>
      ) : null}
      {avgDurationSeconds !== null && avgDurationSeconds > 0 ? (
        <span>均耗: {avgDurationSeconds}s</span>
      ) : null}
      <span className="text-amber-300">★ {starRating}星</span>
    </div>
  );
}
