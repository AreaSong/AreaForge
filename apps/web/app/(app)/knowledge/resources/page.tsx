import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { listStudyResources } from "@/lib/study/study-resource-service";

export const dynamic = "force-dynamic";

export default async function KnowledgeResourcesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const resources = await listStudyResources(user.id);

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">资料资产来自 StudyResource；链接不触发服务端抓取。</p>
      <ul className="divide-y divide-white/10 rounded-md border border-white/10">
        {resources.length === 0 ? (
          <li className="px-4 py-8 text-sm text-zinc-500">暂无资料。可从画布快捷创建或 API 新增。</li>
        ) : (
          resources.map((resource) => (
            <li key={resource.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="text-zinc-100">{resource.title}</p>
                <p className="text-xs text-zinc-500">
                  {resource.sourceType}
                  {resource.displayHost ? ` · ${resource.displayHost}` : ""}
                </p>
              </div>
              <Link className="text-teal-300 hover:underline" href={`/knowledge/resources/${resource.id}`}>
                打开
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
