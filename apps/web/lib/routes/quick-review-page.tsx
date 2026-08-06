import { redirect } from "next/navigation";
import { QuickReviewClient } from "@/components/quick-review-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getReviewSchedule, type ReviewScheduleDto } from "@/lib/study/review-schedule-service";
import { getActiveStudySession } from "@/lib/study/service";
import { getRouteMetadata, sanitizeReturnPath } from "@/lib/navigation/batch7";
import { ApiError } from "@/lib/api/responses";
import { getReviewTarget } from "@/lib/study/review-target-service";
import { isKnowledgeReviewActivityForSchedule } from "@/lib/study/activity-route";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/reviews/schedule/run");

export default async function QuickReviewPage({
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
  const returnTo = sanitizeReturnPath(query.returnTo ?? "/today");

  let schedule: ReviewScheduleDto;
  try {
    schedule = await getReviewSchedule(user.id, scheduleId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      redirect(returnTo);
    }
    throw error;
  }

  const active = await getActiveStudySession(user.id);
  if (active && !isKnowledgeReviewActivityForSchedule(active, schedule.id)) {
    redirect(`/focus?returnTo=${encodeURIComponent(returnTo)}`);
  }

  let target;
  try {
    target = await getReviewTarget(user.id, schedule.id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      redirect(returnTo);
    }
    throw error;
  }
  return <QuickReviewClient userId={user.id} schedule={schedule} target={target} returnTo={returnTo} initialNow={new Date().toISOString()} />;
}
