import { WorkspaceRequiredLayout } from "@/components/workspace-required-layout";

export default function KnowledgeLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceRequiredLayout>{children}</WorkspaceRequiredLayout>;
}
