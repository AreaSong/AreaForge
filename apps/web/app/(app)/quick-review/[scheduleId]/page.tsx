import { redirect } from "next/navigation";
import { QuickReviewClient } from "@/components/quick-review-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getReviewSchedule, type ReviewScheduleDto } from "@/lib/study/review-schedule-service";
import { getActiveStudySession } from "@/lib/study/service";
import { sanitizeReturnPath } from "@/lib/navigation/batch7";
import { ApiError } from "@/lib/api/responses";

export const dynamic = "force-dynamic";

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

  const active = await getActiveStudySession();
  if (active) {
    redirect(`/focus/${active.id}?returnTo=${encodeURIComponent(returnTo)}`);
  }

  let schedule: ReviewScheduleDto;
  try {
    schedule = await getReviewSchedule(user.id, scheduleId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      redirect("/today");
    }
    throw error;
  }

  return <QuickReviewClient schedule={schedule} returnTo={returnTo} />;
}
