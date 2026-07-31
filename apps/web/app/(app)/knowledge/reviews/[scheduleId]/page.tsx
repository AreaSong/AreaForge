import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ReviewScheduleActions } from "@/components/review-schedule-actions";
import { ReviewScheduleDetailHeading } from "@/components/review-schedule-detail-heading";
import { ReviewEventCorrection } from "@/components/review-event-correction";
import { ApiError } from "@/lib/api/responses";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, sanitizeReturnPath } from "@/lib/navigation/batch7";
import { getReviewSchedule, listReviewEvents } from "@/lib/study/review-schedule-service";

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
  const [schedule, events] = await Promise.all([
    getReviewSchedule(user.id, scheduleId),
    listReviewEvents(user.id, scheduleId),
  ]).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  const correctedIds = new Set(events.flatMap((event) => event.correctedEventId ? [event.correctedEventId] : []));
  const latestEffectiveEvent = events.find((event) => !correctedIds.has(event.id));

  return (
    <article className="space-y-5">
      <Link className="text-sm text-teal-300 hover:underline" href={returnTo}>返回复习队列</Link>
      <header>
        <p className="text-sm text-teal-300">{schedule.targetType}</p>
        <ReviewScheduleDetailHeading />
        <p className="mt-2 text-sm text-zinc-400">{schedule.status} · 到期 {schedule.dueDate ? new Date(schedule.dueDate).toLocaleDateString("zh-CN") : "未设置"} · 连续通过 {schedule.consecutivePassCount}</p>
      </header>
      <div className="flex flex-wrap gap-3">
        <ReviewScheduleActions id={schedule.id} status={schedule.status} revision={schedule.revision} />
        {schedule.status === "ACTIVE" ? <Link className="h-10 rounded-md border border-white/10 px-4 text-sm leading-10 text-teal-300" href={`/quick-review/${schedule.id}?returnTo=${encodeURIComponent(`/knowledge/reviews/${schedule.id}?returnTo=${encodeURIComponent(returnTo)}`)}`}>开始快速复习</Link> : null}
      </div>
      <section className="rounded-md border border-white/10 bg-[#101419] p-4">
        <h2 className="font-medium text-white">事件历史</h2>
        <ul className="mt-3 space-y-3">
          {events.map((event) => <li key={event.id} className="text-sm text-zinc-300"><span className="text-white">{event.result}</span> · {event.durationSeconds} 秒 · {new Date(event.confirmedAt).toLocaleString("zh-CN")}{event.correctedEventId ? <span className="ml-2 text-xs text-amber-300">更正事件</span> : correctedIds.has(event.id) ? <span className="ml-2 text-xs text-zinc-500">已被更正</span> : null}{event.note ? <p className="mt-1 text-zinc-500">{event.note}</p> : null}{latestEffectiveEvent?.id === event.id ? <ReviewEventCorrection event={event} scheduleRevision={schedule.revision} /> : null}</li>)}
          {events.length === 0 ? <li className="text-sm text-zinc-500">尚无复习事件。</li> : null}
        </ul>
      </section>
    </article>
  );
}
