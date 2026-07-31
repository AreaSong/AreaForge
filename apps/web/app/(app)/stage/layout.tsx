import { WorkspaceRequiredLayout } from "@/components/workspace-required-layout";

export default function StageLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceRequiredLayout>{children}</WorkspaceRequiredLayout>;
}
