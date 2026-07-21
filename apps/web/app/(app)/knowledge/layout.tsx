import Link from "next/link";
import { KNOWLEDGE_TAB_ITEMS } from "@/lib/navigation/batch7";

export default function KnowledgeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
      <header className="space-y-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-teal-300/80">Knowledge</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">知识工作台</h1>
          <p className="mt-1 text-sm text-zinc-500">画布派生真实关系；卡片、错题、资料与复习共用同一对象。</p>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="知识工作台">
          {KNOWLEDGE_TAB_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/5 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
