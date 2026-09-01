import { Textarea } from "@/components/ui/field";
import { ArrowLeft, BookOpen, Download } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { LearningTreeBatchArchiveButton } from "@/components/learning-tree-import-history";
import { ButtonLink, buttonClassName } from "@/components/ui/button";
import { Badge } from "@/components/ui/feedback";
import { PageFrame, PageHeader, SectionHeader, Toolbar } from "@/components/ui/page";
import { ApiError } from "@/lib/api/responses";
import { getCurrentUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/formatters";
import { getRouteMetadata, sanitizeReturnPath } from "@/lib/navigation/app-navigation";
import { getLearningTreeImport } from "@/lib/study/learning-tree-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/imports/import");

export default async function KnowledgeImportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ importId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { importId } = await params;
  const query = await searchParams;
  const returnTo = query.returnTo ? sanitizeReturnPath(query.returnTo) : "/knowledge/imports";
  const batch = await getLearningTreeImport(user.id, importId).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  const appliedCount = batch.items.filter((item) => item.applyResult === "applied").length;
  const skippedCount = batch.items.filter((item) => item.applyResult === "skipped").length;

  return (
    <PageFrame variant="dashboard-wide" className="space-y-5">
      <PageHeader
        eyebrow="学习树导入结果"
        title="导入批次"
        description={`${scopeLabel(batch.scope)} · ${formatDateTime(batch.confirmedAt)}`}
        back={<ButtonLink href={returnTo} variant="ghost" size="sm"><ArrowLeft size={16} aria-hidden />返回导入历史</ButtonLink>}
        status={<div className="flex flex-wrap gap-2"><Badge tone="success">已应用 {appliedCount}</Badge><Badge>已跳过 {skippedCount}</Badge><Badge>共 {batch.items.length} 项</Badge></div>}
        action={<ButtonLink href="/knowledge/syllabi" variant="primary"><BookOpen size={16} aria-hidden />查看考纲结果</ButtonLink>}
      />
      <Toolbar label="导入批次操作">
        <a className={buttonClassName({ variant: "secondary", size: "sm" })} href={`/api/learning-tree/imports/${batch.id}/export`}>
          <Download size={15} aria-hidden />下载规范化 Markdown
        </a>
        <LearningTreeBatchArchiveButton
          batchId={batch.id}
          archived={Boolean(batch.archivedAt)}
          workspaceStatus={batch.workspaceStatus}
          workspaceRevision={batch.workspaceRevision}
        />
      </Toolbar>
      <section className="space-y-3">
        <SectionHeader title="导入明细" description="每一项均来自本次确认时冻结的差异与选择。" />
        <ul className="divide-y divide-white/10 border-y border-white/10 text-sm">
        {batch.items.map((item) => (
          <li key={item.id} className="px-1 py-3 text-zinc-300">
            <p>{diffTypeLabel(item.diffType)} · {objectTypeLabel(item.objectType)} · {applyResultLabel(item.applyResult)}</p>
            <p className="mt-1 text-xs text-zinc-500">
              稳定标识 {item.stableRef} · 源文件第 {item.sourceLine ?? "?"} 行
              {item.mappedTargetKey ? ` · 映射到 ${item.mappedTargetKey}` : ""}
              {item.redactedErrorCode ? " · 处理失败，错误详情已脱敏" : ""}
            </p>
          </li>
        ))}
        </ul>
      </section>
      <details className="border-t border-white/10 pt-4">
        <summary className="cursor-pointer text-sm text-zinc-300">技术校验信息</summary>
        <dl className="af-content-grid-two mt-4 grid gap-3 text-sm">
          <div><dt className="text-zinc-500">协议 / 解析器</dt><dd className="text-zinc-300">{batch.protocolVersion} / {batch.parserVersion}</dd></div>
          <div><dt className="text-zinc-500">学习树根版本</dt><dd className="text-zinc-300">{batch.rootRevision}</dd></div>
          <div><dt className="text-zinc-500">源 SHA-256</dt><dd className="break-all text-zinc-300">{batch.sourceSha256}</dd></div>
          <div><dt className="text-zinc-500">规范化计划摘要</dt><dd className="break-all text-zinc-300">{batch.canonicalPlanHash}</dd></div>
        </dl>
        <details className="mt-4 border-t border-white/10 pt-3">
          <summary className="cursor-pointer text-sm text-zinc-300">查看规范化源版本</summary>
          <Textarea className="mt-3 min-h-80 w-full rounded-md border border-white/10 bg-[#101419] p-3 font-mono text-xs text-zinc-300" readOnly value={batch.canonicalMarkdown} aria-label="规范化学习树 Markdown" />
        </details>
      </details>
    </PageFrame>
  );
}

function scopeLabel(value: string) { return value === "global" ? "全局" : value === "subject" ? "单科" : value === "branch" ? "分支" : "自定义范围"; }
function objectTypeLabel(value: string) { return ({ group: "科目组", subject: "科目", node: "考纲节点", card: "知识卡片", resource: "资料", plan: "计划" } as Record<string, string>)[value] ?? "对象"; }
function diffTypeLabel(value: string) { return ({ ADD: "新增", UPDATE: "更新", MOVE: "移动", ARCHIVE: "归档", UNCHANGED: "未变化", CONFLICT: "冲突映射", SKIP: "跳过" } as Record<string, string>)[value] ?? "变更"; }
function applyResultLabel(value: string) { return value === "applied" ? "已应用" : value === "skipped" ? "已跳过" : "未应用"; }
