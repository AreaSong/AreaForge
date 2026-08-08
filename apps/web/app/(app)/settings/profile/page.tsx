import { redirect } from "next/navigation";
import { AiDraftPanel } from "@/components/ai-draft-panel";
import { MotivationVaultForm } from "@/components/motivation-vault-form";
import { MotivationLibraryClient } from "@/components/motivation-library-client";
import { MotivationReminderSettings } from "@/components/motivation-reminder-settings";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { listMotivationItems } from "@/lib/study/motivation-library-service";
import { getMotivationVault } from "@/lib/study/service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/settings/profile");

export default async function SettingsProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [vault, items] = await Promise.all([
    getMotivationVault(),
    listMotivationItems(user.id, true),
  ]);

  return (
    <PageFrame variant="dashboard-wide" className="space-y-10">
      <PageHeader
        eyebrow="设置 / 档案与动机"
        title="档案与动机"
        description="封存长期备考的底层理由，并决定哪些内容可以在关键节点被再次展示。动机封存正文默认不进入 AI。"
      />
      <MotivationVaultForm userId={user.id} vault={vault} />
      <MotivationReminderSettings userId={user.id} />
      <MotivationLibraryClient userId={user.id} initialItems={items} vault={vault} />
      <section className="border-t border-white/10 pt-6">
        <SectionHeader
          title="AI 草稿"
          description="低频辅助入口。仅在你主动展开并提交时生成建议，不会自动读取动机封存正文。"
        />
        <details className="mt-4 rounded-md border border-white/10 bg-white/[0.02] px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-teal-300">展开动机 AI 草稿</summary>
          <div className="mt-4"><AiDraftPanel endpoint="motivation" userId={user.id} /></div>
        </details>
      </section>
    </PageFrame>
  );
}
