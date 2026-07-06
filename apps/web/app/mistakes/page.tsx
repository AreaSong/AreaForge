import { ArrowLeft, AlertCircle } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MistakeLibrary } from "@/components/mistake-library";
import { getCurrentUser } from "@/lib/auth/session";
import { listMistakes } from "@/lib/study/mistakes-service";
import { listSubjects } from "@/lib/study/service";
import { listSyllabusTree } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";

export default async function MistakesPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [subjects, nodes, mistakes] = await Promise.all([listSubjects(), listSyllabusTree(), listMistakes()]);

  return (
    <main className="min-h-screen bg-[#080b0f] text-zinc-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3 text-sm text-teal-300">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <span>AreaForge / Mistakes</span>
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
              错题与掌握证明
            </h1>
            <p className="mt-2 text-sm text-zinc-500">把不会、错因和复习时间变成考纲节点的证据。</p>
          </div>
          <Link
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10"
            href="/"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            返回作战台
          </Link>
        </header>

        <MistakeLibrary subjects={subjects} nodes={nodes} mistakes={mistakes} />
      </div>
    </main>
  );
}
