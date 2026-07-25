import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getSyllabusNode } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";

export default async function SyllabusNodeDetailPage({ params }: { params: Promise<{ nodeId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { nodeId } = await params;
  const node = await getSyllabusNode(user.id, nodeId);

  return (
    <article className="space-y-5">
      <Link className="text-sm text-teal-300 hover:underline" href="/knowledge/syllabus">
        返回考纲树
      </Link>
      <header>
        <p className="text-sm text-teal-300">{node.subjectName}</p>
        <h1 className="mt-1 text-2xl font-semibold text-white">{node.title}</h1>
        <p className="mt-2 text-sm text-zinc-400">
          {node.kind} · {node.status} · 掌握等级 {node.masteryLevel ?? "尚未记录"}
        </p>
      </header>
      <section className="grid gap-3 sm:grid-cols-3">
        <Metric label="目标投入" value={`${node.targetMinutes} 分钟`} />
        <Metric label="实际投入" value={`${node.actualMinutes} 分钟`} />
        <Metric label="证据数量" value={`${node.masteryProof.evidenceCount}`} />
      </section>
      <section className="rounded-md border border-white/10 bg-[#101419] p-4">
        <h2 className="font-medium text-white">掌握证据</h2>
        <p className="mt-2 text-sm text-zinc-400">{node.masteryProof.nextAction}</p>
        <ul className="mt-3 space-y-2 text-sm text-zinc-300">
          {node.masteryEvidence.map((evidence) => (
            <li key={evidence.id}>{evidence.summary || evidence.evidenceType} · {new Date(evidence.createdAt).toLocaleDateString("zh-CN")}</li>
          ))}
          {node.masteryEvidence.length === 0 ? <li className="text-zinc-500">尚无显式证据。</li> : null}
        </ul>
      </section>
      <section className="rounded-md border border-white/10 bg-[#101419] p-4">
        <h2 className="font-medium text-white">复测历史</h2>
        <ul className="mt-3 space-y-2 text-sm text-zinc-300">
          {node.masteryRetests.map((retest) => (
            <li key={retest.id}>{retest.result} · {new Date(retest.testedAt).toLocaleDateString("zh-CN")}{retest.score ? ` · ${retest.score}` : ""}</li>
          ))}
          {node.masteryRetests.length === 0 ? <li className="text-zinc-500">尚无复测记录。</li> : null}
        </ul>
      </section>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-white/10 bg-[#101419] p-4"><p className="text-xs text-zinc-500">{label}</p><p className="mt-2 text-lg text-white">{value}</p></div>;
}
