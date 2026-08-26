import { ArrowRight, BookOpenCheck, CircleAlert, FileText, Network } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, EmptyState } from "@/components/ui/feedback";
import { Metric } from "@/components/ui/metric";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/formatters";
import { getRouteMetadata, withReturnTo } from "@/lib/navigation/app-navigation";
import { getKnowledgeOverview } from "@/lib/study/knowledge-canvas-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge");

export default async function KnowledgeOverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const overview = await getKnowledgeOverview(user.id);

  const signals = [
    { label: "待复习", value: overview.dueReviews, href: "/knowledge/reviews", note: "已到期" },
    { label: "薄弱节点", value: overview.weakNodes, href: "/knowledge/syllabi", note: "需要补强" },
    { label: "待整理资料", value: overview.pendingResources, href: "/knowledge/resources", note: "尚未关联" },
    { label: "知识资产", value: overview.canvasSummary.noteCount + overview.canvasSummary.mistakeCount, href: "/knowledge/canvas", note: "卡片与错题" },
  ];

  return (
    <PageFrame variant="dashboard-wide">
      <PageHeader
        eyebrow={overview.workspaceName}
        title="知识概览"
        description="从学习证据进入到期复习，完成后把结果写回掌握状态。"
      />

      <Card variant="accent" className="p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)]" />
              <p className="text-xs font-semibold uppercase tracking-wider text-teal-300">当前下一行动</p>
            </div>
            <h2 className="mt-2 break-words text-xl font-semibold text-white">{overview.nextAction?.label ?? "当前没有必须处理的知识项"}</h2>
            <p className="mt-1 text-sm text-zinc-300">{nextActionDescription(overview.nextAction?.kind)}</p>
          </div>
          <div className="shrink-0">
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
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {signals.map((signal) => (
          <Link key={signal.label} href={signal.href} className="group transition-transform active:scale-[0.98]">
            <Card variant="subtle" className="h-full p-4 transition-colors group-hover:border-teal-500/30 group-hover:bg-white/[0.04]">
              <Metric label={signal.label} value={signal.value} detail={signal.note} layout="compact" valueSize="2xl" />
            </Card>
          </Link>
        ))}
      </div>

      <section className="space-y-4">
        <SectionHeader title="最近学习证据" description="专注收口产生的卡片与错题会在这里继续进入复习。" />
        {overview.recentEvidence.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {overview.recentEvidence.map((item) => (
              <Card key={`${item.type}-${item.id}`} variant="master" className="flex flex-col justify-between p-4 transition-colors hover:border-white/20">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="info">{item.label}</Badge>
                    <span className="text-xs text-zinc-400">{item.subjectName}</span>
                    <span className="text-xs text-zinc-500">· {formatDate(item.updatedAt)}</span>
                  </div>
                  <h3 className="mt-2.5 truncate font-medium text-white">{item.title}</h3>
                </div>
                <div className="mt-4 flex items-center justify-end border-t border-white/5 pt-3">
                  <Link
                    href={withReturnTo(item.href, "/knowledge")}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-300 transition-colors hover:text-teal-200"
                    aria-label={`打开 ${item.title}`}
                  >
                    <span>打开证据</span>
                    <ArrowRight size={14} aria-hidden />
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            title="还没有学习证据"
            description="完成一次专注收口并创建知识卡片或错题后，这里会出现可继续处理的内容。"
            action={
              <ButtonLink href="/today" variant="secondary">
                <FileText size={15} aria-hidden />返回今日行动
              </ButtonLink>
            }
          />
        )}
      </section>

      {overview.weakNodes > 0 ? (
        <Card variant="subtle" className="border-amber-400/30 bg-amber-400/[0.04] p-4">
          <p className="flex items-center gap-2 text-sm text-amber-200">
            <CircleAlert size={16} className="shrink-0 text-amber-400" aria-hidden />
            <span>还有 {overview.weakNodes} 个薄弱节点，完成到期复习后再处理。</span>
          </p>
        </Card>
      ) : null}
    </PageFrame>
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
