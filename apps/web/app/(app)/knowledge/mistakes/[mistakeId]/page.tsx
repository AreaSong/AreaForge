import { redirect } from "next/navigation";
import { BackToListLink } from "@/components/list-return-context";
import { getCurrentUser } from "@/lib/auth/session";
import { getMistakeById } from "@/lib/study/mistakes-service";

export const dynamic = "force-dynamic";

export default async function KnowledgeMistakeDetailPage({
  params,
}: {
  params: Promise<{ mistakeId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { mistakeId } = await params;
  const mistake = await getMistakeById(mistakeId, user.id);
  if (!mistake) redirect("/knowledge/mistakes");

  return (
    <article className="space-y-4">
      <BackToListLink className="text-sm text-teal-300 hover:underline" fallbackHref="/knowledge/mistakes">
        返回错题列表
      </BackToListLink>
      <header>
        <p className="text-xs text-zinc-500">
          {mistake.subjectName} · {mistake.cause}
        </p>
        <h2 className="mt-1 text-2xl font-semibold text-white">{mistake.title}</h2>
      </header>
      <p className="text-sm text-zinc-300">{mistake.correctIdea || "暂无正确思路记录"}</p>
    </article>
  );
}
