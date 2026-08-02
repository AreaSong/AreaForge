import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { KnowledgeNextAction } from "@/components/knowledge-next-action";
import { ReviewScheduleActions } from "@/components/review-schedule-actions";
import { ReviewScheduleDetailHeading } from "@/components/review-schedule-detail-heading";
import { ReviewEventCorrection } from "@/components/review-event-correction";
import { SafeMarkdownView } from "@/components/safe-markdown-view";
import { ButtonLink } from "@/components/ui/button";
import { ApiError } from "@/lib/api/responses";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, sanitizeReturnPath, withReturnTo } from "@/lib/navigation/batch7";
import { getReturnContextLabel } from "@/lib/navigation/return-context";
import { getReviewSchedule, listReviewEvents } from "@/lib/study/review-schedule-service";
import { getReviewTarget } from "@/lib/study/review-target-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/reviews/schedule");

export default async function ReviewScheduleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ scheduleId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { scheduleId } = await params;
  const query = await searchParams;
  const returnTo = sanitizeReturnPath(query.returnTo ?? "/knowledge/reviews");
  const [schedule, events, target] = await Promise.all([
    getReviewSchedule(user.id, scheduleId),
    listReviewEvents(user.id, scheduleId),
    getReviewTarget(user.id, scheduleId),
  ]).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  const correctedIds = new Set(events.flatMap((event) => event.correctedEventId ? [event.correctedEventId] : []));
  const latestEffectiveEvent = events.find((event) => !correctedIds.has(event.id));
  const scheduleHref = withReturnTo(`/knowledge/reviews/${schedule.id}`, returnTo);

  const quickReviewHref = withReturnTo(`/quick-review/${schedule.id}`, scheduleHref);

  return (
    <article className="space-y-6">
      <Link className="text-sm text-teal-300 hover:underline" href={returnTo}>{getReturnContextLabel(returnTo, "返回复习队列")}</Link>
      <header className="border-b border-white/10 pb-5">
        <p className="text-sm text-teal-300">{target.subtitle}</p>
        <ReviewScheduleDetailHeading />
        <p className="mt-2 text-sm text-zinc-400">{schedule.status === "ACTIVE" ? "活动排期" : "已暂停"} · 到期 {formatDate(schedule.dueDate)} · 连续通过 {schedule.consecutivePassCount} 次</p>
      </header>

      <KnowledgeNextAction
        title={schedule.status === "ACTIVE" ? "进入快速复习，确认下一次掌握" : "先恢复排期，再开始复习"}
        description={schedule.status === "ACTIVE"
          ? `下一次复习安排在 ${formatDate(schedule.dueDate)}。确认后会写入复习历史，并重新计算下次复习日期。`
          : "排期已暂停，当前不能开始快速复习。恢复时需要明确选择首次复习日期。请在下方排期管理中处理。"}
        status={schedule.status === "ACTIVE"
          ? <span className="rounded-md border border-teal-300/30 bg-teal-300/10 px-3 py-2 text-sm text-teal-100">活动排期</span>
          : <span className="rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">已暂停</span>}
        action={schedule.status === "ACTIVE" ? (
          <ButtonLink href={quickReviewHref} variant="primary" size="md">
            <Play size={16} aria-hidden />
            开始快速复习
            <ArrowRight size={16} aria-hidden />
          </ButtonLink>
        ) : null}
      />

      <section className="space-y-3 border-y border-white/10 py-5" aria-labelledby="review-target-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><p className="text-xs text-zinc-500">复习对象</p><h2 id="review-target-heading" className="mt-1 break-words text-lg font-medium text-white">{target.title}</h2></div>
          <Link className="text-sm text-teal-300 hover:underline" href={withReturnTo(target.canonicalHref, scheduleHref)}>打开对象详情</Link>
        </div>
        <SafeMarkdownView nodes={target.body} />
      </section>

      <section className="space-y-3 border-b border-white/10 pb-5" aria-labelledby="review-schedule-management-heading">
        <div>
          <h2 id="review-schedule-management-heading" className="font-medium text-white">排期管理</h2>
          <p className="mt-1 text-sm text-zinc-400">暂停、恢复属于排期管理，不会替代本次快速复习。</p>
        </div>
        <ReviewScheduleActions id={schedule.id} status={schedule.status} revision={schedule.revision} returnTo={returnTo} />
      </section>

      <section className="rounded-md border border-white/10 bg-[#101419] p-4" aria-labelledby="review-event-history-heading">
        <h2 id="review-event-history-heading" className="font-medium text-white">事件历史</h2>
        <ul className="mt-3 space-y-3">
          {events.map((event) => <li key={event.id} className="border-b border-white/10 pb-3 text-sm text-zinc-300 last:border-0 last:pb-0"><span className="text-white">{resultLabel(event.result)}</span> · {formatDuration(event.durationSeconds)} · {formatDateTime(event.confirmedAt)}{event.correctedEventId ? <span className="ml-2 text-xs text-amber-300">更正事件</span> : correctedIds.has(event.id) ? <span className="ml-2 text-xs text-zinc-500">已被更正</span> : null}<p className="mt-1 text-xs text-zinc-500">下次复习 {formatDate(event.nextDueDate)} · 连续通过变化 {formatDelta(event.consecutivePassDelta)}</p>{event.note ? <p className="mt-1 text-zinc-500">{event.note}</p> : null}{latestEffectiveEvent?.id === event.id ? <ReviewEventCorrection event={event} scheduleRevision={schedule.revision} /> : null}</li>)}
          {events.length === 0 ? <li className="text-sm text-zinc-500">尚无复习事件。</li> : null}
        </ul>
      </section>
    </article>
  );
}

function resultLabel(value: "PASSED" | "PARTIAL" | "FAILED") { return value === "PASSED" ? "通过" : value === "PARTIAL" ? "部分掌握" : "未通过"; }
function formatDate(value: string | null) { return value ? new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未设置"; }
function formatDateTime(value: string) { return new Date(value).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }); }
function formatDuration(seconds: number) { const minutes = Math.floor(seconds / 60); const remainder = seconds % 60; return minutes ? `${minutes} 分 ${remainder} 秒` : `${remainder} 秒`; }
function formatDelta(value: number) { return value > 0 ? `+${value}` : `${value}`; }
