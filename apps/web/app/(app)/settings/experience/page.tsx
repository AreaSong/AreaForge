import { ExperienceSettingsClient } from "@/components/experience-settings-client";
import { ButtonLink } from "@/components/ui/button";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const metadata = getRouteMetadata("/settings/experience");

export default function SettingsExperiencePage() {
  return (
    <PageFrame variant="dashboard-wide">
      <PageHeader
        eyebrow="设置 / 体验"
        title="体验设置"
        description="调整当前设备上的界面显示与交互偏好。"
        action={<ButtonLink href="/today" variant="secondary">返回今日行动</ButtonLink>}
      />
      <ExperienceSettingsClient />
    </PageFrame>
  );
}
