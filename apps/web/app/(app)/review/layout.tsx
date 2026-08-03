import { WorkspaceRequiredLayout } from "@/components/workspace-required-layout";

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceRequiredLayout>{children}</WorkspaceRequiredLayout>;
}
