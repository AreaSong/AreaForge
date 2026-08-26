import {
  ArrowRight,
  BookOpen,
  BookOpenCheck,
  CircleAlert,
  FileText,
  HelpCircle,
  Layers,
  Network,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KnowledgeEbbinghausDistribution } from "@/components/knowledge-ebbinghaus-distribution";
import { KnowledgeSubjectMasteryPanel } from "@/components/knowledge-subject-mastery-panel";
import { KnowledgeWeakPointsRanking } from "@/components/knowledge-weak-points-ranking";
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
    {
      label: "知识资产",
      value: overview.canvasSummary.noteCount + overview.canvasSummary.mistakeCount,
      href: "/knowledge/canvas",
      note: `${overview.canvasSummary.noteCount} 卡片 · ${overview.canvasSummary.mistakeCount} 错题`,
    },
    {
      label: "今日待复习",
      value: overview.dueReviews,
      href: "/knowledge/reviews",
      note: overview.dueReviews > 0 ? "需处理到期项" : "无逾期积压",
    },
    {
      label: "综合掌握率",
      value: `${overview.overallMasteryRate}%`,
      href: "/knowledge/points",
      note: "加权掌握度",
    },
    {
      label: "薄弱节点",
      value: overview.weakNodes,
      href: "/knowledge/syllabi",
      note: `${overview.topWeakPoints.length} 个薄弱考点`,
    },
    {
      label: "7日留存率",
      value: `${overview.ebbinghausStats.retentionRate7d}%`,
      href: "/knowledge/reviews",
      note: "艾宾浩斯复习留存",
    },
  ];

  const gateways = [
    { label: "知识卡片", count: overview.canvasSummary.noteCount, href: "/knowledge/cards", icon: FileText, desc: "题解与理解沉淀" },
    { label: "错题本", count: overview.canvasSummary.mistakeCount, href: "/knowledge/mistakes", icon: HelpCircle, desc: "错因分类与归因" },
    { label: "考点工作台", count: overview.canvasSummary.totalKnowledgePoints ?? 0, href: "/knowledge/points", icon: Layers, desc: "跨考纲复用对象" },
    { label: "考纲知识树", count: overview.weakNodes > 0 ? `${overview.weakNodes}薄弱` : "全景", href: "/knowledge/syllabi", icon: BookOpen, desc: "层级目录与目标" },
    { label: "知识画布", count: "关联图", href: "/knowledge/canvas", icon: Network, desc: "网状关联与导图" },
  ];

  return (
    <PageFrame variant="dashboard-wide" className="space-y-4 sm:space-y-5">
      <PageHeader
        eyebrow={overview.workspaceName}
        title="知识中心"
        description="个人知识资产沉淀、艾宾浩斯复习总览与多科掌握度全景仪表盘。"
      />

      {/* Command Strip / Next Action Banner */}
      <Card variant="accent" className="p-4 sm:p-5">
        <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.8)]" />
              <p className="text-xs font-semibold uppercase tracking-wider text-teal-300">当前下一行动</p>
            </div>
            <h2 className="mt-1.5 break-words text-lg font-semibold text-white sm:text-xl">
              {overview.nextAction?.label ?? "当前没有必须处理的知识项"}
            </h2>
            <p className="mt-1 text-xs text-zinc-300 sm:text-sm">{nextActionDescription(overview.nextAction?.kind)}</p>
          </div>
          <div className="shrink-0">
            {overview.nextAction ? (
              <ButtonLink href={overview.nextAction.href} variant="primary" className="w-full sm:w-auto">
                <BookOpenCheck size={15} aria-hidden />
                {nextActionLabel(overview.nextAction.kind)}
              </ButtonLink>
            ) : (
              <ButtonLink href="/knowledge/canvas" variant="secondary" className="w-full sm:w-auto">
                <Network size={15} aria-hidden />
                打开关联画布
              </ButtonLink>
            )}
          </div>
        </div>
      </Card>

      {/* High-Density 5-KPI Tiles Row */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {signals.map((signal) => (
          <Link key={signal.label} href={signal.href} className="group transition-transform active:scale-[0.98]">
            <Card
              variant="subtle"
              className="h-full p-3 transition-colors group-hover:border-teal-500/30 group-hover:bg-white/[0.04] sm:p-3.5"
            >
              <Metric label={signal.label} value={signal.value} detail={signal.note} layout="compact" valueSize="xl" />
            </Card>
          </Link>
        ))}
      </div>

      {/* SECTION 1: Ebbinghaus Review Retention Distribution Bar */}
      <KnowledgeEbbinghausDistribution stats={overview.ebbinghausStats} />

      {/* SECTION 2: 2-Column Analytics Grid (Mastery Panel + Weak Points Ranking) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <KnowledgeSubjectMasteryPanel
          subjects={overview.subjectMastery}
          radarDimensions={overview.radarDimensions}
          overallMasteryRate={overview.overallMasteryRate}
        />
        <KnowledgeWeakPointsRanking weakPoints={overview.topWeakPoints} />
      </div>

      {/* SECTION 3: Quick Sub-view Gateways */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {gateways.map((gw) => {
          const Icon = gw.icon;
          return (
            <Link
              key={gw.label}
              href={gw.href}
              className="group flex flex-col justify-between rounded-xl border border-white/10 bg-[#0e1619]/90 p-3 transition-all hover:border-teal-400/30 hover:bg-white/[0.04] active:scale-[0.98]"
            >
              <div className="flex items-center justify-between">
                <Icon size={16} className="text-teal-400 transition-colors group-hover:text-teal-300" aria-hidden />
                <span className="font-mono text-xs font-semibold text-zinc-400 group-hover:text-zinc-200">
                  {gw.count}
                </span>
              </div>
              <div className="mt-2.5">
                <p className="text-xs font-semibold text-white group-hover:text-teal-200">{gw.label}</p>
                <p className="text-[10.5px] text-zinc-500 truncate">{gw.desc}</p>
              </div>
            </Link>
          );
        })}
      </div>

      {/* SECTION 4: Recent Learning Evidence Grid */}
      <section className="space-y-3">
        <SectionHeader title="最近学习证据" description="专注收口产生的卡片与错题会在这里继续进入复习与复测。" />
        {overview.recentEvidence.length ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {overview.recentEvidence.map((item) => (
              <Card
                key={`${item.type}-${item.id}`}
                variant="master"
                className="flex flex-col justify-between p-3.5 sm:p-4 transition-colors hover:border-white/20"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="info">{item.label}</Badge>
                    <span className="text-xs text-zinc-400">{item.subjectName}</span>
                    <span className="text-xs text-zinc-500">· {formatDate(item.updatedAt)}</span>
                  </div>
                  <h3 className="mt-2 truncate text-sm font-medium text-white">{item.title}</h3>
                </div>
                <div className="mt-3 flex items-center justify-end border-t border-white/5 pt-2.5">
                  <Link
                    href={withReturnTo(item.href, "/knowledge")}
                    className="inline-flex items-center gap-1 text-xs font-medium text-teal-300 transition-colors hover:text-teal-200"
                    aria-label={`打开 ${item.title}`}
                  >
                    <span>打开证据</span>
                    <ArrowRight size={13} aria-hidden />
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
                <FileText size={15} aria-hidden />
                返回今日行动
              </ButtonLink>
            }
          />
        )}
      </section>

      {/* Weak Nodes Callout */}
      {overview.weakNodes > 0 ? (
        <Card variant="subtle" className="border-amber-400/30 bg-amber-400/[0.04] p-3.5 sm:p-4">
          <p className="flex items-center gap-2 text-xs sm:text-sm text-amber-200">
            <CircleAlert size={16} className="shrink-0 text-amber-400" aria-hidden />
            <span>还有 {overview.weakNodes} 个考纲薄弱节点，完成到期复习后再前往考纲进行补强。</span>
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
