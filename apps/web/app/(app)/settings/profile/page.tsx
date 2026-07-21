import { redirect } from "next/navigation";
import { MotivationVaultForm } from "@/components/motivation-vault-form";
import { MotivationLibraryClient } from "@/components/motivation-library-client";
import { getCurrentUser } from "@/lib/auth/session";
import { listMotivationItems } from "@/lib/study/motivation-library-service";
import { getMotivationVault } from "@/lib/study/service";

export const dynamic = "force-dynamic";

export default async function SettingsProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [vault, items] = await Promise.all([
    getMotivationVault(),
    listMotivationItems(user.id),
  ]);

  return (
    <section className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-white">个人档案与动机</h2>
        <p className="mt-1 text-sm text-zinc-400">
          动机封存正文默认不进入 AI。内容库可保存语录、HTTPS 视频链接或显式摘录。
        </p>
      </div>
      <MotivationVaultForm vault={vault} />
      <MotivationLibraryClient initialItems={items} />
    </section>
  );
}
