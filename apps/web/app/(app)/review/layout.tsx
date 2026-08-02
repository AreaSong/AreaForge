import { ReviewNavigation } from "@/components/review-navigation";
import { WorkspaceRequiredLayout } from "@/components/workspace-required-layout";

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceRequiredLayout>
      <div className="flex min-h-0 flex-1 flex-col gap-5">
        <header className="border-b border-white/10 pb-3"><ReviewNavigation /></header>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </WorkspaceRequiredLayout>
  );
}
