import Link from "next/link";
import { redirect } from "next/navigation";
import { PlanInboxClient } from "@/components/plan-inbox-client";
import { getCurrentUser } from "@/lib/auth/session";
import { findActiveWorkspaceOrNull } from "@/lib/study/exam-workspace-service";
import { listPlanInboxItems } from "@/lib/study/plan-inbox-service";

export const dynamic = "force-dynamic";

export default async function TodayInboxPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const workspace = await findActiveWorkspaceOrNull(user.id);
  if (!workspace) {
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold text-white">收件箱</h1>
        <Link href="/settings/workspace?setup=1" className="text-teal-300 hover:underline">
          先设置考试目标
        </Link>
      </section>
    );
  }
  const items = await listPlanInboxItems(user.id, "OPEN");
  return <PlanInboxClient items={items} />;
}
