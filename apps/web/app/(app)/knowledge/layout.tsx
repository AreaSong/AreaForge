import { KnowledgeNavigation } from "@/components/knowledge-navigation";

export default function KnowledgeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
      <header className="space-y-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-teal-300/80">Knowledge</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">知识工作台</h1>
          <p className="mt-1 text-sm text-zinc-500">画布派生真实关系；卡片、错题、资料与复习共用同一对象。</p>
        </div>
        <KnowledgeNavigation />
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
