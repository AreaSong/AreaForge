import { WorkspaceRequiredLayout } from "@/components/workspace-required-layout";

export default function ConfirmationsLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceRequiredLayout>{children}</WorkspaceRequiredLayout>;
}
