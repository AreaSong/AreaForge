import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { listLearningTreeImports } from "@/lib/study/learning-tree-service";

export const dynamic = "force-dynamic";

export default async function KnowledgeImportsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const imports = await listLearningTreeImports(user.id);

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">已确认的学习树导入批次。预览/确认仍走现有 API。</p>
      <ul className="divide-y divide-white/10 rounded-md border border-white/10">
        {imports.length === 0 ? (
          <li className="px-4 py-8 text-sm text-zinc-500">暂无导入记录。</li>
        ) : (
          imports.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="text-zinc-100">
                  {item.scope} · {item.protocolVersion}
                </p>
                <p className="text-xs text-zinc-500">
                  {item.itemCount} 项 · {new Date(item.confirmedAt).toLocaleString("zh-CN")}
                </p>
              </div>
              <Link className="text-teal-300 hover:underline" href={`/knowledge/imports/${item.id}`}>
                详情
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
