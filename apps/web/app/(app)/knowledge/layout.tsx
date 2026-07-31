import { KnowledgeNavigation } from "@/components/knowledge-navigation";
import { WorkspaceRequiredLayout } from "@/components/workspace-required-layout";

export default function KnowledgeLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceRequiredLayout>
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
        <header className="border-b border-white/10 pb-3">
          <KnowledgeNavigation />
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </WorkspaceRequiredLayout>
  );
}
