import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { AiSettingsClient } from "@/components/ai-settings-client";
import { ButtonLink } from "@/components/ui/button";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";
import { getAiDraftRuntimeStatus } from "@/lib/study/ai-draft-status";
import { getAiProviderCredentialStatus } from "@/lib/study/ai-provider-credential-service";
import { readAiProviderPreference } from "@/lib/study/ai-provider-preference";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/settings/ai");

export default async function SettingsAiPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [status, providerStatus] = await Promise.all([
    getAiDraftRuntimeStatus(),
    getAiProviderCredentialStatus(user.id),
  ]);
  const preference = readAiProviderPreference(await cookies());

  return (
    <PageFrame variant="dashboard-wide">
      <PageHeader
        eyebrow="设置 / AI"
        title="AI 设置"
        description="仅显式提交触发；四类草稿需选中文本并预览。密钥与 binding secret 不进入客户端。"
        action={<ButtonLink href="/today" variant="secondary">返回今日行动</ButtonLink>}
      />
      <AiSettingsClient
        userId={user.id}
        initialRuntimeStatus={status}
        bindingSecretConfigured={status.bindingSecretConfigured}
        initialExternalProviderEnabled={preference.externalProviderEnabled}
        initialProviderStatus={providerStatus}
      />
    </PageFrame>
  );
}
