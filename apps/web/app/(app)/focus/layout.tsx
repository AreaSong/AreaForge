import { WorkspaceRequiredLayout } from "@/components/workspace-required-layout";

export default function FocusLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceRequiredLayout>{children}</WorkspaceRequiredLayout>;
}
