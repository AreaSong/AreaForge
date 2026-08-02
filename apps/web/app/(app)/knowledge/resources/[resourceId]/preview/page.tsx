import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { parseSafeMarkdown } from "@areaforge/core";
import { DetailHeading } from "@/components/detail-heading";
import { SafeMarkdownView } from "@/components/safe-markdown-view";
import { ApiError } from "@/lib/api/responses";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata, sanitizeReturnPath, withReturnTo } from "@/lib/navigation/batch7";
import { downloadStudyResource, getStudyResource } from "@/lib/study/study-resource-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/knowledge/resources/resource/preview");

const previewableTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "text/markdown"]);

export default async function StudyResourcePreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ resourceId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { resourceId } = await params;
  const query = await searchParams;
  const detailHref = `/knowledge/resources/${encodeURIComponent(resourceId)}`;
  const returnTo = query.returnTo ? sanitizeReturnPath(query.returnTo) : detailHref;
  const user = await getCurrentUser();
  if (!user) {
    const currentPath = withReturnTo(`${detailHref}/preview`, returnTo);
    redirect(`/login?returnTo=${encodeURIComponent(currentPath)}`);
  }
  const resource = await getStudyResource(user.id, resourceId).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  if (resource.sourceType !== "FILE" || !resource.mimeType || !previewableTypes.has(resource.mimeType)) {
    redirect(returnTo);
  }
  const source = `/api/study-resources/${resource.id}/download?disposition=inline`;
  const markdownNodes = resource.mimeType === "text/markdown"
    ? parseSafeMarkdown(new TextDecoder("utf-8", { fatal: true }).decode((await downloadStudyResource(user.id, resource.id, "inline")).bytes))
    : null;

  return (
    <article className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm text-teal-300">私有鉴权预览</p><DetailHeading className="mt-1 text-xl font-semibold text-white">{resource.title}</DetailHeading></div>
        <div className="flex gap-2"><Link className="h-10 rounded-md border border-white/10 px-3 text-sm leading-10 text-zinc-200" href={returnTo}>返回资料详情</Link><a className="h-10 rounded-md bg-teal-500 px-3 text-sm font-medium leading-10 text-black" href={`/api/study-resources/${resource.id}/download?disposition=attachment`}>下载资料</a></div>
      </header>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0">
          {markdownNodes ? <SafeMarkdownView nodes={markdownNodes} /> : resource.mimeType.startsWith("image/") ? <Image src={source} alt={resource.title} width={1600} height={1200} unoptimized className="h-auto max-h-[75vh] w-auto max-w-full object-contain" /> : <iframe title={`${resource.title} 预览`} src={source} className="h-[75vh] w-full border border-white/10 bg-white" sandbox="allow-same-origin" />}
        </div>
        <aside className="space-y-3 border-t border-white/10 pt-4 text-sm lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0" aria-label="资料元数据">
          <p><span className="text-zinc-500">文件名</span><br /><span className="break-all text-zinc-200">{resource.originalName}</span></p>
          <p><span className="text-zinc-500">MIME</span><br /><span className="text-zinc-200">{resource.mimeType}</span></p>
          <p><span className="text-zinc-500">大小</span><br /><span className="text-zinc-200">{resource.sizeBytes ?? 0} bytes</span></p>
          <p><span className="text-zinc-500">类型</span><br /><span className="text-zinc-200">{resource.category}</span></p>
          <p><span className="text-zinc-500">标签</span><br /><span className="text-zinc-200">{resource.tags.join("、") || "无"}</span></p>
        </aside>
      </div>
    </article>
  );
}
