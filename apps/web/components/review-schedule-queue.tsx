"use client";

import Link from "next/link";
import { ListDetailLink, useRestoreListReturn } from "@/components/list-return-context";
import type {
  BridgedReviewScheduleDto,
  RecentReviewEventDto,
  ReviewScheduleDto,
} from "@/lib/study/review-schedule-service";

const returnTo = "/knowledge/reviews";

export function ReviewScheduleQueue(props: {
  dueSchedules: ReviewScheduleDto[];
  pausedSchedules: ReviewScheduleDto[];
  bridgedSchedules: BridgedReviewScheduleDto[];
  recentEvents: RecentReviewEventDto[];
}) {
  useRestoreListReturn();

  return (
    <div className="space-y-6">
      <ReviewScheduleSection title="到期复习" empty="当前没有到期的可执行复习排期。">
        {props.dueSchedules.map((schedule) => <ScheduleRow key={schedule.id} schedule={schedule} />)}
      </ReviewScheduleSection>

      <ReviewScheduleSection title="已暂停" empty="当前没有暂停的复习排期。">
        {props.pausedSchedules.map((schedule) => <ScheduleRow key={schedule.id} schedule={schedule} paused />)}
      </ReviewScheduleSection>

      <ReviewScheduleSection title="已桥接到任务" empty="当前没有已桥接的复习排期。">
        {props.bridgedSchedules.map(({ schedule, canonicalTask }) => (
          <li key={`${schedule.id}-${canonicalTask.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <div>
              <p className="text-zinc-100">{schedule.targetType} 复习</p>
              <p className="mt-1 text-xs text-zinc-500">已桥接到正式任务，复习确认由该任务闭环。</p>
              <Link href={canonicalTask.href} className="mt-1 inline-flex text-xs text-teal-300 hover:underline">
                规范任务：{canonicalTask.title}（{canonicalTask.status}）
              </Link>
            </div>
            <ListDetailLink
              href={detailHref(schedule.id)}
              focusId={`review-bridge-${schedule.id}-${canonicalTask.id}`}
              className="text-teal-300 hover:underline"
            >
              查看排期
            </ListDetailLink>
          </li>
        ))}
      </ReviewScheduleSection>

      <ReviewScheduleSection title="近期复习事件" empty="尚无复习事件。">
        {props.recentEvents.map((event) => (
          <li key={event.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <div>
              <p className="text-zinc-100">{event.schedule.targetType} · {event.result}</p>
              <p className="text-xs text-zinc-500">{event.durationSeconds} 秒 · {new Date(event.confirmedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>
            </div>
            <ListDetailLink href={detailHref(event.schedule.id)} focusId={`review-event-${event.id}`} className="text-teal-300 hover:underline">
              查看详情
            </ListDetailLink>
          </li>
        ))}
      </ReviewScheduleSection>
    </div>
  );
}

function ReviewScheduleSection(props: { title: string; empty: string; children: React.ReactNode }) {
  const hasItems = Array.isArray(props.children) ? props.children.length > 0 : Boolean(props.children);
  return (
    <section className="space-y-2" aria-labelledby={`review-section-${props.title}`}>
      <h2 id={`review-section-${props.title}`} className="text-lg font-medium text-white">{props.title}</h2>
      <ul className="divide-y divide-white/10 rounded-md border border-white/10">
        {hasItems ? props.children : <li className="px-4 py-6 text-sm text-zinc-500">{props.empty}</li>}
      </ul>
    </section>
  );
}

function ScheduleRow(props: { schedule: ReviewScheduleDto; paused?: boolean }) {
  const { schedule, paused = false } = props;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      <div>
        <p className="text-zinc-100">{schedule.targetType} 复习</p>
        <p className="text-xs text-zinc-500">
          {paused ? `暂停原因：${schedule.pausedReason ?? "未说明"}` : `到期 ${formatDate(schedule.dueDate)}`} · 连续通过 {schedule.consecutivePassCount}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {!paused ? (
          <ListDetailLink href={quickReviewHref(schedule.id)} focusId={`review-quick-${schedule.id}`} className="text-teal-300 hover:underline">
            开始复习
          </ListDetailLink>
        ) : null}
        <ListDetailLink href={detailHref(schedule.id)} focusId={`review-detail-${schedule.id}`} className="text-teal-300 hover:underline">
          查看详情
        </ListDetailLink>
      </div>
    </li>
  );
}

function quickReviewHref(scheduleId: string) {
  return `/quick-review/${scheduleId}?returnTo=${encodeURIComponent(returnTo)}`;
}

function detailHref(scheduleId: string) {
  return `/knowledge/reviews/${scheduleId}?returnTo=${encodeURIComponent(returnTo)}`;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未设置";
}
