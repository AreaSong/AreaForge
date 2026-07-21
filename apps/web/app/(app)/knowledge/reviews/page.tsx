import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { listReviewSchedules } from "@/lib/study/review-schedule-service";

export const dynamic = "force-dynamic";

export default async function KnowledgeReviewsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const schedules = await listReviewSchedules(user.id, { status: "ACTIVE" });

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">统一复习列表。确认动作进入快速复习页。</p>
      <ul className="divide-y divide-white/10 rounded-md border border-white/10">
        {schedules.length === 0 ? (
          <li className="px-4 py-8 text-sm text-zinc-500">当前没有可执行的复习排期。</li>
        ) : (
          schedules.map((schedule) => (
            <li key={schedule.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="text-zinc-100">{schedule.targetType}</p>
                <p className="text-xs text-zinc-500">
                  到期 {schedule.dueDate ? new Date(schedule.dueDate).toLocaleDateString("zh-CN") : "—"} · 连续通过{" "}
                  {schedule.consecutivePassCount}
                </p>
              </div>
              <Link className="text-teal-300 hover:underline" href={`/quick-review/${schedule.id}`}>
                开始复习
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
