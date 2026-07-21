import Link from "next/link";
import { redirect } from "next/navigation";
import { SimulationListClient } from "@/components/simulation-list-client";
import { getCurrentUser } from "@/lib/auth/session";
import { listSimulationExams } from "@/lib/study/simulation-service";

export const dynamic = "force-dynamic";

export default async function StageSimulationPage() {
  const user = await getCurrentUser(); if (!user) redirect("/login");
  const exams = await listSimulationExams(user.id);
  return <section className="space-y-5"><div><p className="text-sm text-teal-300">阶段</p><h1 className="text-2xl font-semibold text-white">模拟考试</h1><p className="mt-1 text-sm text-zinc-400">保存分科事实，再显式选择是否把补救加入计划收件箱。</p></div><SimulationListClient/><div className="grid gap-3">{exams.length ? exams.map((exam) => <Link key={exam.id} href={`/stage/simulation/${exam.id}`} className="rounded-md border border-white/10 bg-[#101419] p-4 hover:border-teal-400/40"><div className="flex justify-between gap-3"><span className="font-medium text-white">{exam.name}</span><span className="text-xs text-zinc-500">{new Date(exam.examDate).toLocaleDateString("zh-CN")}</span></div><p className="mt-2 text-sm text-zinc-400">{exam.totalsSource === "legacy_fallback" ? "旧记录只读 totals" : `${exam.actualScore ?? 0} / ${exam.targetScore ?? 0} 分 · ${exam.subjectResults.length} 科`}</p>{exam.warnings.length ? <p className="mt-2 text-xs text-amber-200">{exam.warnings[0]}</p> : null}</Link>) : <p className="rounded-md border border-dashed border-white/10 p-6 text-sm text-zinc-500">还没有模拟记录。</p>}</div></section>;
}
