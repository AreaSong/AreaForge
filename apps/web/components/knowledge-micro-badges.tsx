import { CheckCircle, Clock, History, Star } from "lucide-react";

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
    <div className="flex flex-wrap items-center gap-1 text-[10.5px]">
      {/* 作答次数 */}
      <span
        title={`已作答复习 ${attemptCount} 次`}
        className="inline-flex items-center gap-0.5 rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-zinc-300"
      >
        <History size={10.5} className="text-zinc-400" aria-hidden />
        <span>作答: {attemptCount}次</span>
      </span>

      {/* 正答率 */}
      {passRate !== null ? (
        <span
          title={`历史正答率 ${passRate}%`}
          className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-mono ${
            passRate >= 80
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : passRate >= 60
                ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
                : "border-amber-500/30 bg-amber-500/10 text-amber-300"
          }`}
        >
          <CheckCircle size={10.5} aria-hidden />
          <span>正答: {passRate}%</span>
        </span>
      ) : null}

      {/* 均耗 */}
      {avgDurationSeconds !== null && avgDurationSeconds > 0 ? (
        <span
          title={`平均单重复习耗时 ${avgDurationSeconds} 秒`}
          className="inline-flex items-center gap-0.5 rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-zinc-300"
        >
          <Clock size={10.5} className="text-zinc-400" aria-hidden />
          <span>均耗: {avgDurationSeconds}s</span>
        </span>
      ) : null}

      {/* 重要度星级 */}
      <span
        title={`熟练/重要度等级 ★${starRating}`}
        className="inline-flex items-center gap-0.5 rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 font-mono text-amber-300"
      >
        <Star size={10.5} className="fill-amber-400 text-amber-400" aria-hidden />
        <span>★ {starRating}星</span>
      </span>

      {/* 复习距今天数 */}
      {isOverdue ? (
        <span className="inline-flex items-center gap-0.5 rounded border border-rose-500/30 bg-rose-500/15 px-1.5 py-0.5 font-mono text-rose-300">
          <span>逾期待复习</span>
        </span>
      ) : isDueToday ? (
        <span className="inline-flex items-center gap-0.5 rounded border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 font-mono text-amber-300">
          <span>今日到期</span>
        </span>
      ) : daysSinceReview !== null ? (
        <span
          title={`距上次复习/更新 ${daysSinceReview} 天`}
          className="inline-flex items-center gap-0.5 rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-zinc-400"
        >
          <span>{daysSinceReview === 0 ? "今日已复习" : `${daysSinceReview}天前复习`}</span>
        </span>
      ) : null}
    </div>
  );
}

/**
 * Micro-Badge Cluster for Mistake Card
 */
export function MistakeMicroBadgeCluster({ metrics }: { metrics: MistakeCardMetrics }) {
  const { attemptCount, passRate, avgDurationSeconds, starRating, daysSinceReview, isDueToday, isOverdue } = metrics;

  return (
    <div className="flex flex-wrap items-center gap-1 text-[10.5px]">
      {/* 作答次数 */}
      <span
        title={`已作答纠错 ${attemptCount} 次`}
        className="inline-flex items-center gap-0.5 rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-zinc-300"
      >
        <History size={10.5} className="text-zinc-400" aria-hidden />
        <span>作答: {attemptCount}次</span>
      </span>

      {/* 正答率 */}
      {passRate !== null ? (
        <span
          title={`纠错正答率 ${passRate}%`}
          className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-mono ${
            passRate >= 80
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : passRate >= 50
                ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                : "border-rose-500/30 bg-rose-500/10 text-rose-300"
          }`}
        >
          <CheckCircle size={10.5} aria-hidden />
          <span>正答: {passRate}%</span>
        </span>
      ) : null}

      {/* 均耗 */}
      {avgDurationSeconds !== null && avgDurationSeconds > 0 ? (
        <span
          title={`平均纠错耗时 ${avgDurationSeconds} 秒`}
          className="inline-flex items-center gap-0.5 rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-zinc-300"
        >
          <Clock size={10.5} className="text-zinc-400" aria-hidden />
          <span>均耗: {avgDurationSeconds}s</span>
        </span>
      ) : null}

      {/* 难度/星级 */}
      <span
        title={`难度/考频评级 ★${starRating}`}
        className="inline-flex items-center gap-0.5 rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 font-mono text-amber-300"
      >
        <Star size={10.5} className="fill-amber-400 text-amber-400" aria-hidden />
        <span>★ {starRating}星</span>
      </span>

      {/* 复习状态 */}
      {isOverdue ? (
        <span className="inline-flex items-center gap-0.5 rounded border border-rose-500/30 bg-rose-500/15 px-1.5 py-0.5 font-mono text-rose-300">
          <span>逾期待复习</span>
        </span>
      ) : isDueToday ? (
        <span className="inline-flex items-center gap-0.5 rounded border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 font-mono text-amber-300">
          <span>今日到期</span>
        </span>
      ) : daysSinceReview !== null ? (
        <span
          title={`距上次纠错/复习 ${daysSinceReview} 天`}
          className="inline-flex items-center gap-0.5 rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-zinc-400"
        >
          <span>{daysSinceReview === 0 ? "今日已复习" : `${daysSinceReview}天前复习`}</span>
        </span>
      ) : null}
    </div>
  );
}
