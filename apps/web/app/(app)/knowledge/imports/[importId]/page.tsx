import Link from "next/link";
import { redirect } from "next/navigation";
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
      </header>
      <ul className="divide-y divide-white/10 rounded-md border border-white/10 text-sm">
        {batch.items.slice(0, 50).map((item) => (
          <li key={item.id} className="px-4 py-2 text-zinc-300">
            {item.objectType} · {item.applyResult} · {item.stableRef}
          </li>
        ))}
      </ul>
    </article>
  );
}
