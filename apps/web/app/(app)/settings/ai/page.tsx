import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Bot, KeyRound, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { AiSettingsClient } from "@/components/ai-settings-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
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
    <PageFrame variant="dashboard-wide" className="space-y-6">
      <PageHeader
        eyebrow="设置 / AI"
        title="AI 设置"
        description="仅显式提交触发；四类草稿需选中文本并预览。密钥与 binding secret 不进入客户端。"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr] xl:grid-cols-[320px_1fr]">
        {/* Left Column (Aside) */}
        <aside className="space-y-5">
          <Card variant="master" className="space-y-4">
            <CardHeader className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-teal-300">
                  AI 服务状态
                </span>
                <Badge tone={status.effectiveEnabled ? "success" : "warning"}>
                  {status.effectiveEnabled ? "已启用" : "仅本地回退"}
                </Badge>
              </div>
              <CardTitle className="text-base flex items-center gap-2">
                <Bot className="size-4 text-teal-400" />
                <span>受控 AI 运行态</span>
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3 pt-0 text-sm">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 space-y-2 text-xs text-zinc-300">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Provider 来源</span>
                  <span className="font-medium text-white">
                    {providerStatus.source === "account" ? "当前账户" : providerStatus.source === "environment" ? "部署环境" : "未配置"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">密钥加密状态</span>
                  <span className="font-medium text-teal-300">
                    {providerStatus.apiKeyConfigured ? "已加密保存" : "未配置"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Binding 密钥</span>
                  <span className="font-medium text-zinc-300">
                    {status.bindingSecretConfigured ? "已就绪" : "未配置"}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-teal-300">
                <ShieldCheck className="size-4 shrink-0" />
                <span>不外发未选正文、动机档案与附件</span>
              </div>
            </CardContent>
          </Card>

          <Card variant="subtle" className="space-y-3">
            <CardHeader className="space-y-1">
              <CardTitle className="text-sm flex items-center gap-2">
                <Lock className="size-3.5 text-teal-300" />
                <span>隐私与安全原则</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 pt-0 text-xs text-zinc-400">
              <p>• <strong className="text-zinc-300">零数据留存：</strong>不保存 prompt 与原始 response。</p>
              <p>• <strong className="text-zinc-300">显式提交：</strong>仅由用户主动点击触发，无静默抓取。</p>
              <p>• <strong className="text-zinc-300">沙箱回退：</strong>外部 Provider 不可用时自动降级为本地规则。</p>
              <p>• <strong className="text-zinc-300">凭据安全：</strong>API Key 仅存于服务端受控密文，不回显前端。</p>
            </CardContent>
          </Card>
        </aside>

        {/* Right Column (Main) */}
        <main className="space-y-6 min-w-0">
          <AiSettingsClient
            userId={user.id}
            initialRuntimeStatus={status}
            bindingSecretConfigured={status.bindingSecretConfigured}
            initialExternalProviderEnabled={preference.externalProviderEnabled}
            initialProviderStatus={providerStatus}
          />
        </main>
      </div>
    </PageFrame>
  );
}
