import { redirect } from "next/navigation";
import { AiSettingsClient } from "@/components/ai-settings-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getAiDraftBindingStatus } from "@/lib/study/ai-draft-status";

export const dynamic = "force-dynamic";

export default async function SettingsAiPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const status = getAiDraftBindingStatus();

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-white">AI 设置</h2>
        <p className="mt-1 text-sm text-zinc-400">
          仅显式 POST 触发；四类草稿需选中文本并预览。密钥与 binding secret 不进入客户端。
        </p>
      </div>
      <AiSettingsClient
        aiEnabled={status.aiEnabled}
        modelConfigured={status.modelConfigured}
        bindingSecretConfigured={status.bindingSecretConfigured}
      />
    </section>
  );
}
