import Link from "next/link";
import { redirect } from "next/navigation";
import { PlanInboxClient } from "@/components/plan-inbox-client";
import { getCurrentUser } from "@/lib/auth/session";
import { findActiveWorkspaceOrNull } from "@/lib/study/exam-workspace-service";
import { getRouteMetadata, sanitizeReturnPath, withReturnTo } from "@/lib/navigation/batch7";
import { listPlanInboxItems, matchesPlanInboxStableRef } from "@/lib/study/plan-inbox-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/today/inbox");

export default async function TodayInboxPage({ searchParams }: { searchParams: Promise<{ status?: string; stableRef?: string; returnTo?: string }> }) {
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
  const query = await searchParams;
  const status = query.status === "DISMISSED" || query.status === "CONVERTED" ? query.status : "OPEN";
  const listed = await listPlanInboxItems(user.id, query.stableRef ? undefined : status);
  const items = query.stableRef
    ? listed.filter((item) => matchesPlanInboxStableRef(item, query.stableRef as string))
    : listed;
  const sourceReturnTo = query.returnTo ? sanitizeReturnPath(query.returnTo) : undefined;
  const returnTo = buildPlanInboxHref({
    status,
    stableRef: query.stableRef,
    includeStatus: query.status !== undefined,
    sourceReturnTo,
  });
  return <PlanInboxClient items={items} status={status} returnTo={returnTo} />;
}

function buildPlanInboxHref(input: {
  status: "OPEN" | "DISMISSED" | "CONVERTED";
  stableRef?: string;
  includeStatus: boolean;
  sourceReturnTo?: string;
}): string {
  const params = new URLSearchParams();
  if (input.includeStatus) params.set("status", input.status);
  if (input.stableRef) params.set("stableRef", input.stableRef);
  const href = `/today/inbox${params.size ? `?${params.toString()}` : ""}`;
  return input.sourceReturnTo ? withReturnTo(href, input.sourceReturnTo) : href;
}
