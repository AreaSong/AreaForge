import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getStudyResource } from "@/lib/study/study-resource-service";

export const dynamic = "force-dynamic";

export default async function KnowledgeResourceDetailPage({
  params,
}: {
  params: Promise<{ resourceId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { resourceId } = await params;
  const resource = await getStudyResource(user.id, resourceId);

  return (
    <article className="space-y-4">
      <Link className="text-sm text-teal-300 hover:underline" href="/knowledge/resources">
        返回资料列表
      </Link>
      <header>
        <p className="text-xs text-zinc-500">{resource.sourceType}</p>
        <h2 className="mt-1 text-2xl font-semibold text-white">{resource.title}</h2>
      </header>
      {resource.externalUrl ? (
        <p className="text-sm text-zinc-400">
          外链域名：{resource.displayHost ?? "—"}（服务端不抓取内容）
        </p>
      ) : (
        <p className="text-sm text-zinc-400">文件型资料通过鉴权附件接口访问。</p>
      )}
    </article>
  );
}
