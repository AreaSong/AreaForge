import { ArrowRight, AlertTriangle } from "lucide-react";
import { ListDetailLink } from "@/components/list-return-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { labelCause, labelResult, reviewSummary } from "@/components/mistake-library-support";
import { calculateStarRating, getDaysAgo, isNextReviewDueToday, isNextReviewOverdue, MistakeMicroBadgeCluster } from "@/components/knowledge-micro-badges";
import type { MistakeDto } from "@/lib/contracts";
import { formatDateTime } from "@/lib/formatters";

export function MistakeCard({ mistake }: { mistake: MistakeDto }) {
  const needsCompletion = mistake.cause === "unknown" || !mistake.correctIdea?.trim();
  const attempts = mistake.attempts ?? [];
  const reviewHistory = mistake.reviewHistory ?? [];
  const attemptCount = mistake.attemptCount || attempts.length || reviewHistory.length;
  const passedAttempts = attempts.filter((a) => a.result === "PASSED").length + reviewHistory.filter((r) => r.result === "PASSED").length;
  const totalRecorded = attempts.length + reviewHistory.length;
  const passRate = totalRecorded > 0 ? Math.round((passedAttempts / totalRecorded) * 100) : null;
  const totalDuration = attempts.reduce((sum, a) => sum + (a.durationSeconds || 0), 0) + reviewHistory.reduce((sum, r) => sum + (r.durationSeconds || 0), 0);
  const avgDurationSeconds = totalRecorded > 0 ? Math.round(totalDuration / totalRecorded) : null;
  const consecutivePassCount = mistake.reviewSchedule?.consecutivePassCount ?? 0;
  const starRating = calculateStarRating(mistake.cause === "unknown" ? "unknown" : "partial", consecutivePassCount);

  const lastTouch = mistake.lastAttemptAt || attempts[0]?.attemptedAt || reviewHistory[0]?.confirmedAt || mistake.updatedAt;
  const daysSinceReview = getDaysAgo(lastTouch);
  const isOverdue = isNextReviewOverdue(mistake.nextReviewAt);
  const isDueToday = isNextReviewDueToday(mistake.nextReviewAt);

  return (
    <Card variant="master" className="flex flex-col justify-between p-3.5 sm:p-4 transition-all hover:border-white/20">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-zinc-400">{mistake.subjectName}</span>
          <Badge tone={mistake.cause === "unknown" ? "warning" : "danger"}>
            {labelCause(mistake.cause)}
          </Badge>
          {reviewSummary(mistake) ? <Badge tone="warning">复习 {reviewSummary(mistake)}</Badge> : null}
          {mistake.archivedAt ? <Badge>已归档</Badge> : null}
        </div>

        {/* Micro-Badges Cluster */}
        <div className="mt-2">
          <MistakeMicroBadgeCluster
            metrics={{
              attemptCount,
              passRate,
              avgDurationSeconds,
              consecutivePassCount,
              starRating,
              daysSinceReview,
              isDueToday,
              isOverdue,
            }}
          />
        </div>

        <h3 className="mt-2.5 break-words text-sm font-semibold text-white sm:text-base">{mistake.title}</h3>
        <p className="mt-1 text-xs text-zinc-400">{mistake.syllabusNodeTitle ?? "未关联考纲"}</p>
        <p className="mt-2.5 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-zinc-300 sm:text-sm sm:leading-6">
          {mistake.questionText || "这条历史错题还没有完整题面。"}
        </p>
      </div>

      <div className="mt-4 border-t border-white/5 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
          <div className="flex min-w-0 flex-wrap gap-x-2">
            {mistake.source ? <span className="truncate max-w-[10rem]">来源：{mistake.source}</span> : null}
            <span>作答 {mistake.attemptCount} 次{mistake.attempts[0] ? ` · 最近${labelResult(mistake.attempts[0].result)}` : ""}</span>
            <span>更新：{formatDateTime(mistake.updatedAt)}</span>
          </div>
          <ListDetailLink
            href={`/knowledge/mistakes/${mistake.id}`}
            focusId={`mistake-${mistake.id}`}
            className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-teal-300 transition-colors hover:bg-white/[0.05] hover:text-teal-200"
          >
            打开详情
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </ListDetailLink>
        </div>

        {needsCompletion ? (
          <div className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
            <span>待补全错因和正确思路后才能进入快速复习</span>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
