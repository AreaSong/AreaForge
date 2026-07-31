import { redirect } from "next/navigation";
import { AiDraftPanel } from "@/components/ai-draft-panel";
import { MotivationVaultForm } from "@/components/motivation-vault-form";
import { MotivationLibraryClient } from "@/components/motivation-library-client";
import { MotivationReminderSettings } from "@/components/motivation-reminder-settings";
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
    <section className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-white">个人档案与动机</h1>
        <p className="mt-1 text-sm text-zinc-400">
          动机封存正文默认不进入 AI。内容库可保存语录、HTTPS 视频链接或显式摘录。
        </p>
      </div>
      <details className="rounded-md border border-white/10 p-3">
        <summary className="cursor-pointer text-sm text-teal-300">动机 AI 草稿</summary>
        <div className="mt-3"><AiDraftPanel endpoint="motivation" userId={user.id} /></div>
      </details>
      <MotivationVaultForm userId={user.id} vault={vault} />
      <MotivationReminderSettings userId={user.id} />
      <MotivationLibraryClient userId={user.id} initialItems={items} vault={vault} />
    </section>
  );
}
