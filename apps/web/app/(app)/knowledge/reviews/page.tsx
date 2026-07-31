import { redirect } from "next/navigation";
import { ReviewScheduleQueue } from "@/components/review-schedule-queue";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import {
  listBridgedReviewSchedules,
  listRecentReviewEvents,
  listReviewSchedules,
} from "@/lib/study/review-schedule-service";
import { getStudyDayRange } from "@/lib/study/date";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/reviews");

export default async function KnowledgeReviewsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const today = getStudyDayRange();
  const [dueSchedules, pausedSchedules, bridgedSchedules, recentEvents] = await Promise.all([
    listReviewSchedules(user.id, { status: "ACTIVE", dueBefore: today.end, excludeBridged: true }),
    listReviewSchedules(user.id, { status: "PAUSED", excludeBridged: true }),
    listBridgedReviewSchedules(user.id),
    listRecentReviewEvents(user.id),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-white">统一复习</h1>
      <p className="text-sm text-zinc-500">统一复习队列，按当前可执行状态与近期闭环分区。</p>
      <ReviewScheduleQueue
        dueSchedules={dueSchedules}
        pausedSchedules={pausedSchedules}
        bridgedSchedules={bridgedSchedules}
        recentEvents={recentEvents}
      />
    </div>
  );
}
