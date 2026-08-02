import { redirect } from "next/navigation";
import { DailyReviewFacts } from "@/components/daily-review-facts";
import { ReviewForm } from "@/components/review-form";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { getStudyDayRange } from "@/lib/study/date";
import { getDailyReviewFacts } from "@/lib/study/daily-review-facts-service";
import { resolveActiveWorkspace } from "@/lib/study/exam-workspace-service";
import { getDailyReviewMinimumInboxItem } from "@/lib/study/plan-inbox-service";
import { getTodayReview } from "@/lib/study/service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/review/daily");

export default async function DailyReviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [review, workspace, facts] = await Promise.all([
    getTodayReview(user.id),
    resolveActiveWorkspace(user.id),
    getDailyReviewFacts(user.id),
  ]);
  const inboxItem = review ? await getDailyReviewMinimumInboxItem(user.id, review) : null;

  return (
    <PageFrame variant="content-focus">
      <PageHeader
        eyebrow="今日闭环"
        title="晚间复盘"
        description="先核对今天的事实，再留下判断并确定明日唯一的最低行动。"
      />
      <DailyReviewFacts facts={facts} />
      <ReviewForm
        userId={user.id}
        workspaceId={workspace.id}
        studyDayKey={getStudyDayRange().key}
        review={review}
        inboxItem={inboxItem}
      />
    </PageFrame>
  );
}
