import { ShieldCheck, UserCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/feedback";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { getAiProviderCredentialStatus } from "@/lib/study/ai-provider-credential-service";
import { findActiveWorkspaceOrNull, listWorkspaceSubjects } from "@/lib/study/exam-workspace-service";
import { SettingsCompactGrid } from "@/components/settings/settings-compact-grid";
import { SettingsOfflineIndicator } from "@/components/settings/settings-offline-indicator";
import { SettingsRuntimeCard } from "@/components/settings/settings-runtime-card";
import { SettingsWorkspaceCapacityCard } from "@/components/settings/settings-workspace-capacity";
import { getWorkspaceCapacityMetrics } from "@/lib/study/settings-capacity-service";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/settings");

export default async function SettingsIndexPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [activeWorkspace, aiCredentialStatus] = await Promise.all([
    findActiveWorkspaceOrNull(user.id),
    getAiProviderCredentialStatus(user.id),
  ]);

  const [subjects, capacityMetrics] = await Promise.all([
    activeWorkspace ? listWorkspaceSubjects(user.id, activeWorkspace.id) : Promise.resolve([]),
    getWorkspaceCapacityMetrics(user.id, activeWorkspace?.id),
  ]);

  const activeSubjectCount = subjects.filter((s) => !s.archivedAt).length;
  const isAiConfigured = aiCredentialStatus.source !== "none";

  return (
    <PageFrame variant="dashboard-wide" className="space-y-4">
      <PageHeader
        eyebrow="设置"
        title="设置总览"
        description="IDE 级紧凑参数网格、工作空间存储容量洞察与客户端离线韧性状态一览。"
      />

      {/* 2-Column High-Density Console Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr] xl:grid-cols-[320px_1fr]">
        {/* Left Column: Diagnostics, Storage & Capacity, Offline Sync */}
        <aside className="space-y-4 min-w-0">
          {/* User Account Capsule */}
          <div className="rounded-2xl border border-white/10 bg-[#0e1619]/90 p-3.5 sm:p-4 text-zinc-100 shadow-xl backdrop-blur-md space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="grid size-7 place-items-center rounded-lg bg-teal-500/10 text-teal-300 border border-teal-500/20">
                  <UserCheck size={15} />
                </div>
                <span className="text-xs font-semibold text-white">当前认证会话</span>
              </div>
              <Badge tone="success">已登录</Badge>
            </div>
            <p className="text-xs font-mono text-zinc-300 break-all bg-[#090d0f] p-2 rounded-xl border border-white/5">
              {user.email}
            </p>
          </div>

          {/* Workspace Capacity & Storage Metrics Panel */}
          <SettingsWorkspaceCapacityCard
            workspace={activeWorkspace}
            metrics={capacityMetrics}
          />

          {/* Client Offline Sync & Cache Indicators */}
          <SettingsOfflineIndicator userId={user.id} />
        </aside>

        {/* Right Column: 6-Tile Parameter Grid & Runtime Metrics */}
        <main className="space-y-4 min-w-0">
          {/* 6-Tile Compact Parameter Grid */}
          <section aria-labelledby="settings-grid-heading">
            <h2 id="settings-grid-heading" className="sr-only">系统设置导航网格</h2>
            <SettingsCompactGrid
              activeWorkspace={activeWorkspace}
              activeSubjectCount={activeSubjectCount}
              aiConfigured={isAiConfigured}
            />
          </section>

          {/* System Runtime Metrics & Quick Actions */}
          <section aria-labelledby="settings-runtime-heading">
            <h2 id="settings-runtime-heading" className="sr-only">系统运行态与安全基线</h2>
            <SettingsRuntimeCard />
          </section>
        </main>
      </div>
    </PageFrame>
  );
}
