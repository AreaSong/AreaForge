import { ArrowRight, BookOpenCheck, CircleAlert, FileText, Network } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, SectionHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, withReturnTo } from "@/lib/navigation/batch7";
import { getKnowledgeOverview } from "@/lib/study/knowledge-canvas-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge");

export default async function KnowledgeOverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const overview = await getKnowledgeOverview(user.id);

  const signals = [
    { label: "待复习", value: overview.dueReviews, href: "/knowledge/reviews", note: "已到期" },
    { label: "薄弱节点", value: overview.weakNodes, href: "/knowledge/syllabus", note: "需要补强" },
    { label: "待整理资料", value: overview.pendingResources, href: "/knowledge/resources", note: "尚未关联" },
    { label: "知识资产", value: overview.canvasSummary.noteCount + overview.canvasSummary.mistakeCount, href: "/knowledge/canvas", note: "卡片与错题" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={overview.workspaceName}
        title="知识概览"
        description="从学习证据进入到期复习，完成后把结果写回掌握状态。"
      />

      <section className="grid gap-4 border-b border-white/10 pb-6 sm:grid-cols-[minmax(0,1.4fr)_minmax(14rem,0.6fr)] sm:items-center">
        <div className="min-w-0">
          <p className="text-xs font-medium text-teal-300">当前下一行动</p>
          <h2 className="mt-1 break-words text-xl font-medium text-white">{overview.nextAction?.label ?? "当前没有必须处理的知识项"}</h2>
          <p className="mt-2 text-sm text-zinc-400">{nextActionDescription(overview.nextAction?.kind)}</p>
        </div>
        {overview.nextAction ? (
          <ButtonLink href={overview.nextAction.href} variant="primary" className="w-full sm:w-auto">
            <BookOpenCheck size={15} aria-hidden />
            {nextActionLabel(overview.nextAction.kind)}
          </ButtonLink>
        ) : (
          <ButtonLink href="/knowledge/canvas" variant="secondary" className="w-full sm:w-auto">
            <Network size={15} aria-hidden />打开关联画布
          </ButtonLink>
        )}
      </section>

      <div className="grid gap-4 border-b border-white/10 pb-6 sm:grid-cols-2 lg:grid-cols-4">
        {signals.map((signal) => (
          <Link
            key={signal.label}
            href={signal.href}
            className="border-l border-white/10 pl-3 hover:border-teal-400/50"
          >
            <p className="text-xs text-zinc-500">{signal.label}</p>
            <p className="mt-1 text-2xl font-semibold text-white">{signal.value}</p>
            <p className="mt-1 text-xs text-zinc-500">{signal.note}</p>
          </Link>
        ))}
      </div>

      <section className="space-y-4">
        <SectionHeader title="最近学习证据" description="专注收口产生的卡片与错题会在这里继续进入复习。" action={<ButtonLink href="/knowledge/canvas" variant="ghost" size="sm"><Network size={15} aria-hidden />查看关联</ButtonLink>} />
        {overview.recentEvidence.length ? (
          <ul className="divide-y divide-white/10 border-y border-white/10">
            {overview.recentEvidence.map((item) => (
              <li key={`${item.type}-${item.id}`} className="flex items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-zinc-100">{item.title}</p>
                  <p className="mt-1 text-xs text-zinc-500">{item.subjectName} · {item.label} · {formatDate(item.updatedAt)}</p>
                </div>
                <Link href={withReturnTo(item.href, "/knowledge")} className="grid size-9 shrink-0 place-items-center rounded-md text-teal-300 hover:bg-white/[0.06]" aria-label={`打开 ${item.title}`} title="打开证据"><ArrowRight size={16} aria-hidden /></Link>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="还没有学习证据" description="完成一次专注收口并创建知识卡片或错题后，这里会出现可继续处理的内容。" action={<ButtonLink href="/today" variant="secondary"><FileText size={15} aria-hidden />返回今日行动</ButtonLink>} />}
      </section>

      {overview.weakNodes > 0 ? <p className="flex items-center gap-2 border-l-2 border-amber-400/60 pl-3 text-sm text-amber-100"><CircleAlert size={16} aria-hidden />还有 {overview.weakNodes} 个薄弱节点，完成到期复习后再处理。</p> : null}
    </div>
  );
}

function nextActionDescription(kind: "review" | "weak_node" | "resource" | "import" | undefined) {
  if (kind === "review") return "已经到期，直接进入快速复习并确认本次掌握结果。";
  if (kind === "weak_node") return "当前没有到期复习，先补强最需要处理的考纲节点。";
  if (kind === "resource") return "当前没有到期复习，先把未归类资料放回学习关系中。";
  if (kind === "import") return "检查最近导入结果，确认知识树结构是否可用。";
  return "可以继续整理知识关联，或回到今日行动产生新的学习证据。";
}

function nextActionLabel(kind: "review" | "weak_node" | "resource" | "import") {
  if (kind === "review") return "开始下一项复习";
  if (kind === "weak_node") return "打开薄弱节点";
  if (kind === "resource") return "整理这份资料";
  return "检查导入结果";
}

function formatDate(value: string) { return new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }); }
