import { WorkspaceRequiredLayout } from "@/components/workspace-required-layout";

export default function TestLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceRequiredLayout>{children}</WorkspaceRequiredLayout>;
}
