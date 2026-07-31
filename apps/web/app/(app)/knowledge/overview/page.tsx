import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { getKnowledgeOverview } from "@/lib/study/knowledge-canvas-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/overview");

export default async function KnowledgeOverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const overview = await getKnowledgeOverview(user.id);

  const cards = [
    { label: "待复习", value: overview.dueReviews, href: "/knowledge/reviews" },
    { label: "薄弱节点", value: overview.weakNodes, href: "/knowledge/syllabus" },
    { label: "资料资产", value: overview.pendingResources, href: "/knowledge/resources" },
    { label: "导入批次", value: overview.recentImports, href: "/knowledge/imports" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-white">知识概览</h1>
      <section className="space-y-2">
        <h2 className="text-lg font-medium text-white">当前工作区：{overview.workspaceName}</h2>
        <p className="text-sm text-zinc-500">优先处理到期复习与薄弱节点，再回画布检查关联。</p>
        {overview.nextAction ? (
          <Link href={overview.nextAction.href} className="mt-3 inline-flex h-11 items-center rounded-md bg-teal-500 px-4 text-sm font-medium text-black">
            打开最高优先级对象：{overview.nextAction.label}
          </Link>
        ) : (
          <Link href="/knowledge/canvas" className="mt-3 inline-flex h-11 items-center rounded-md bg-teal-500 px-4 text-sm font-medium text-black">
            打开关联画布
          </Link>
        )}
      </section>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="rounded-md border border-white/10 bg-white/[0.03] px-4 py-3 hover:bg-white/[0.06]"
          >
            <p className="text-xs text-zinc-500">{card.label}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{card.value}</p>
          </Link>
        ))}
      </div>
      <section className="rounded-md border border-white/10 px-4 py-3 text-sm text-zinc-400">
        <p>画布摘要</p>
        <p className="mt-2 text-zinc-200">
          卡片 {overview.canvasSummary.noteCount} · 错题 {overview.canvasSummary.mistakeCount} · 资料{" "}
          {overview.canvasSummary.resourceCount}
        </p>
        <Link className="mt-3 inline-block text-teal-300 hover:underline" href="/knowledge/canvas">
          查看画布详情
        </Link>
      </section>
    </div>
  );
}
