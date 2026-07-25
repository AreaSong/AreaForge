import { redirect } from "next/navigation";
import { ReviewForm } from "@/components/review-form";
import { getCurrentUser } from "@/lib/auth/session";
import { getTodayReview } from "@/lib/study/service";

export const dynamic = "force-dynamic";

export default async function DailyReviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const review = await getTodayReview(user.id);

  return (
    <section className="mx-auto w-full max-w-3xl space-y-5">
      <header>
        <p className="text-sm text-teal-300">复盘</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">晚间复盘</h1>
        <p className="mt-2 text-sm text-zinc-400">客观事实与明日最低行动会一起保存，最低行动进入计划收件箱。</p>
      </header>
      <ReviewForm review={review} />
    </section>
  );
}
