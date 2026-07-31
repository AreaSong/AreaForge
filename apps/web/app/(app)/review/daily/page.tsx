import { redirect } from "next/navigation";
import { ReviewForm } from "@/components/review-form";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { getStudyDayRange } from "@/lib/study/date";
import { resolveActiveWorkspace } from "@/lib/study/exam-workspace-service";
import { getTodayReview } from "@/lib/study/service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/review/daily");

export default async function DailyReviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [review, workspace] = await Promise.all([
    getTodayReview(user.id),
    resolveActiveWorkspace(user.id),
  ]);

  return (
    <section className="mx-auto w-full max-w-3xl space-y-5">
      <header>
        <p className="text-sm text-teal-300">复盘</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">晚间复盘</h1>
        <p className="mt-2 text-sm text-zinc-400">客观事实与明日最低行动会一起保存，最低行动进入计划收件箱。</p>
      </header>
      <ReviewForm
        userId={user.id}
        workspaceId={workspace.id}
        studyDayKey={getStudyDayRange().key}
        review={review}
      />
    </section>
  );
}
