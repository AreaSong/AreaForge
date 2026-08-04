import { WorkspaceRequiredLayout } from "@/components/workspace-required-layout";

export default function RoadmapLayout({ children }: { children: React.ReactNode }) {
  return <WorkspaceRequiredLayout>{children}</WorkspaceRequiredLayout>;
}
