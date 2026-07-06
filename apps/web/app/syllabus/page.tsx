import { ArrowLeft, BookOpen } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SyllabusManager } from "@/components/syllabus-manager";
import { getCurrentUser } from "@/lib/auth/session";
import { listSubjects } from "@/lib/study/service";
import { listSyllabusTree } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";

export default async function SyllabusPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [subjects, nodes] = await Promise.all([listSubjects(), listSyllabusTree()]);

  return (
    <main className="min-h-screen bg-[#080b0f] text-zinc-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3 text-sm text-teal-300">
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              <span>AreaForge / Syllabus</span>
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
              考纲进度树
            </h1>
            <p className="mt-2 text-sm text-zinc-500">把任务和计时落到具体知识点。</p>
          </div>
          <Link
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10"
            href="/"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            返回作战台
          </Link>
        </header>

        <SyllabusManager subjects={subjects} nodes={nodes} />
      </div>
    </main>
  );
}
