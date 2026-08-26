import { redirect } from "next/navigation";
import { AiDraftPanel } from "@/components/ai-draft-panel";
import { MotivationVaultForm } from "@/components/motivation-vault-form";
import { MotivationLibraryClient } from "@/components/motivation-library-client";
import { MotivationReminderSettings } from "@/components/motivation-reminder-settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { listMotivationItems } from "@/lib/study/motivation-library-service";
import { getMotivationVault } from "@/lib/study/motivation-vault-service";
import { formatDateTime } from "@/lib/formatters";
import { Lock, ShieldCheck, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/settings/profile");

export default async function SettingsProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [vault, items] = await Promise.all([
    getMotivationVault(),
    listMotivationItems(user.id, true),
  ]);

  const hasVaultContent = Boolean(vault?.whyStarted || vault?.neverReturnTo || vault?.futureSelf);

  return (
    <PageFrame variant="dashboard-wide" className="space-y-6">
      <PageHeader
        eyebrow="设置 / 个人与恢复"
        title="档案与动机"
        description="封存长期备考的底层理由，并决定哪些内容可以在关键节点被再次展示。动机封存正文默认不进入 AI。"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr] xl:grid-cols-[320px_1fr]">
        {/* Left Column (Aside) */}
        <aside className="space-y-5">
          <Card variant="master" className="space-y-4">
            <CardHeader className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-teal-300">
                  封存状态
                </span>
                <Badge tone={hasVaultContent ? "success" : "neutral"}>
                  {hasVaultContent ? "已封存" : "待完善"}
                </Badge>
              </div>
              <CardTitle className="text-base flex items-center gap-2">
                <Lock className="size-4 text-teal-400" />
                <span>备考动机密柜</span>
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3 pt-0 text-sm">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 space-y-1.5 text-xs text-zinc-300">
                <span className="text-zinc-500 block">隐私与密级</span>
                <p className="leading-relaxed">
                  动机封存正文属于高度私密数据，仅保存在受保护的本地数据库，绝不发送至外部 AI Provider。
                </p>
                {vault?.updatedAt ? (
                  <div className="pt-2 border-t border-white/5 text-zinc-500">
                    上次更新：{formatDateTime(vault.updatedAt)}
                  </div>
                ) : null}
              </div>

              <div className="flex items-center gap-2 text-xs text-teal-300">
                <ShieldCheck className="size-4 shrink-0" />
                <span>零数据留存与外泄保护</span>
              </div>
            </CardContent>
          </Card>

          <Card variant="subtle" className="space-y-3">
            <CardHeader className="space-y-1">
              <CardTitle className="text-sm">唤醒原则</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0 text-xs text-zinc-400">
              <div className="border-l-2 border-teal-400/40 pl-2.5 space-y-0.5">
                <strong className="block text-white font-medium">连续失守</strong>
                <p>连续性断裂时只短暂回看一次原因，然后立即回到恢复任务。</p>
              </div>
              <div className="border-l-2 border-teal-400/40 pl-2.5 space-y-0.5">
                <strong className="block text-white font-medium">重大复盘</strong>
                <p>复盘暴露结构性问题时用动机校准方向，不用它替代行动。</p>
              </div>
              <div className="border-l-2 border-teal-400/40 pl-2.5 space-y-0.5">
                <strong className="block text-white font-medium">全真自测</strong>
                <p>第一次全真自测前后确认模拟意义与下一阶段压力。</p>
              </div>
              <div className="border-l-2 border-teal-400/40 pl-2.5 space-y-0.5">
                <strong className="block text-white font-medium">危险期</strong>
                <p>风险等级升高时唤醒底层理由，敏感内容不常驻展示。</p>
              </div>
            </CardContent>
          </Card>
        </aside>

        {/* Right Column (Main) */}
        <main className="space-y-6 min-w-0">
          <MotivationVaultForm userId={user.id} vault={vault} />
          <MotivationReminderSettings userId={user.id} />
          <MotivationLibraryClient userId={user.id} initialItems={items} vault={vault} />

          <Card variant="subtle" className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <Sparkles className="size-4 text-teal-300" />
                  <span>AI 动机草稿</span>
                </h3>
                <p className="mt-1 text-xs text-zinc-400">
                  低频辅助入口。仅在你主动展开并显式提交时生成建议，不会自动读取动机封存正文。
                </p>
              </div>
            </div>

            <details className="rounded-xl border border-white/10 bg-white/[0.01] p-3.5">
              <summary className="cursor-pointer text-sm font-medium text-teal-300 hover:text-teal-200 transition-colors">
                展开动机 AI 草稿面板
              </summary>
              <div className="mt-4 pt-4 border-t border-white/5">
                <AiDraftPanel endpoint="motivation" userId={user.id} />
              </div>
            </details>
          </Card>
        </main>
      </div>
    </PageFrame>
  );
}
