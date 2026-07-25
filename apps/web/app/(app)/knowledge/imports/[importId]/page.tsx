import Link from "next/link";
import { redirect } from "next/navigation";
import { LearningTreeBatchArchiveButton } from "@/components/learning-tree-import-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getLearningTreeImport } from "@/lib/study/learning-tree-service";

export const dynamic = "force-dynamic";

export default async function KnowledgeImportDetailPage({
  params,
}: {
  params: Promise<{ importId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { importId } = await params;
  const batch = await getLearningTreeImport(user.id, importId);

  return (
    <article className="space-y-4">
      <Link className="text-sm text-teal-300 hover:underline" href="/knowledge/imports">
        返回导入列表
      </Link>
      <header>
        <h2 className="text-2xl font-semibold text-white">导入批次</h2>
        <p className="mt-1 text-sm text-zinc-500">
          {batch.scope} · parser {batch.parserVersion} · {batch.items.length} 项
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="inline-flex h-9 items-center rounded-md border border-white/10 px-3 text-sm text-zinc-200" href={`/api/learning-tree/imports/${batch.id}/export`}>
            下载规范化 Markdown
          </a>
          <LearningTreeBatchArchiveButton batchId={batch.id} archived={Boolean(batch.archivedAt)} />
        </div>
      </header>
      <dl className="grid gap-3 border-y border-white/10 py-4 text-sm sm:grid-cols-2">
        <div><dt className="text-zinc-500">源 SHA-256</dt><dd className="break-all text-zinc-300">{batch.sourceSha256}</dd></div>
        <div><dt className="text-zinc-500">Canonical plan hash</dt><dd className="break-all text-zinc-300">{batch.canonicalPlanHash}</dd></div>
        <div><dt className="text-zinc-500">根 revision</dt><dd className="text-zinc-300">{batch.rootRevision}</dd></div>
        <div><dt className="text-zinc-500">确认时间</dt><dd className="text-zinc-300">{new Date(batch.confirmedAt).toLocaleString("zh-CN")}</dd></div>
      </dl>
      <details className="rounded-md border border-white/10 p-3">
        <summary className="cursor-pointer text-sm text-zinc-200">查看规范化源版本</summary>
        <textarea className="mt-3 min-h-80 w-full rounded-md border border-white/10 bg-[#101419] p-3 font-mono text-xs text-zinc-300" readOnly value={batch.canonicalMarkdown} aria-label="规范化学习树 Markdown" />
      </details>
      <ul className="divide-y divide-white/10 rounded-md border border-white/10 text-sm">
        {batch.items.map((item) => (
          <li key={item.id} className="px-4 py-2 text-zinc-300">
            <p>{item.diffType} · {item.objectType} · {item.applyResult} · {item.stableRef}</p>
            <p className="mt-1 text-xs text-zinc-500">
              {item.userChoice} · 第 {item.sourceLine ?? "?"} 行
              {item.mappedTargetKey ? ` · 目标 ${item.mappedTargetKey}` : ""}
              {item.redactedErrorCode ? ` · ${item.redactedErrorCode}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </article>
  );
}
