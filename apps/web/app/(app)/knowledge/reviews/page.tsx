import { redirect } from "next/navigation";
import { ReviewScheduleQueue } from "@/components/review-schedule-queue";
import { PageFrame } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import {
  getReviewWorkbenchSummary,
  listBridgedReviewSchedules,
  listRecentReviewEvents,
  listReviewQueueItems,
} from "@/lib/study/review-schedule-service";
import { getStudyDayRange } from "@/lib/study/date";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/reviews");

export default async function KnowledgeReviewsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const today = getStudyDayRange();
  const [dueItems, pausedItems, bridgedSchedules, recentEvents, summary] = await Promise.all([
    listReviewQueueItems(user.id, { status: "ACTIVE", dueBefore: today.end, excludeBridged: true }),
    listReviewQueueItems(user.id, { status: "PAUSED", excludeBridged: true }),
    listBridgedReviewSchedules(user.id),
    listRecentReviewEvents(user.id),
    getReviewWorkbenchSummary(user.id),
  ]);

  return (
    <PageFrame variant="split-view" className="space-y-6">
      <ReviewScheduleQueue
        dueItems={dueItems}
        pausedItems={pausedItems}
        bridgedSchedules={bridgedSchedules}
        recentEvents={recentEvents}
        summary={summary}
      />
    </PageFrame>
  );
}
