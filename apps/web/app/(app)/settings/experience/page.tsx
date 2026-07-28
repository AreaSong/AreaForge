import { ExperienceSettingsClient } from "@/components/experience-settings-client";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const metadata = getRouteMetadata("/settings/experience");

export default function SettingsExperiencePage() {
  return (
    <section className="space-y-6">
      <h1 className="text-xl font-semibold text-white">体验设置</h1>
      <ExperienceSettingsClient />
    </section>
  );
}
