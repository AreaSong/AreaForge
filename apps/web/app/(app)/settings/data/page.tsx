import { Database, Download, FileInput, HardDrive, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/settings/data");

export default async function SettingsDataPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <PageFrame variant="dashboard-wide" className="space-y-6">
      <PageHeader
        eyebrow="设置 / 数据与安全"
        title="数据与安全"
        description="管理学习树的导入导出入口，了解数据边界和恢复原则。删除、迁移与生产备份仍由受控运维流程处理。"
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr] xl:grid-cols-[320px_1fr]">
        {/* Left Column (Aside) */}
        <aside className="space-y-5">
          <Card variant="master" className="space-y-4">
            <CardHeader className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-teal-300">
                  存储架构
                </span>
                <Badge tone="success">主状态源</Badge>
              </div>
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="size-4 text-teal-400" />
                <span>PostgreSQL 规范</span>
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3 pt-0 text-sm">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 space-y-1.5 text-xs text-zinc-300">
                <span className="text-zinc-500 block">数据安全边界</span>
                <p className="leading-relaxed">
                  Web 应用层永远不直接执行数据库清理、备份恢复、migration 或任意服务器宿主命令。所有生产操作必须通过独立受控运维流程执行。
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs text-teal-300">
                <ShieldCheck className="size-4 shrink-0" />
                <span>附件均通过鉴权接口访问</span>
              </div>
            </CardContent>
          </Card>

          <Card variant="subtle" className="space-y-3">
            <CardHeader className="space-y-1">
              <CardTitle className="text-sm flex items-center gap-2">
                <HardDrive className="size-3.5 text-teal-300" />
                <span>运维与恢复原则</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5 pt-0 text-xs text-zinc-400">
              <p>• 备份文件由服务器侧独立 cron/updater 定时生成并验证。</p>
              <p>• 学习树导入导出支持差异预览，避免误覆盖。</p>
              <p>
                • 需要检查版本运行态与健康指标，请前往{" "}
                <Link href="/settings/system" className="text-teal-300 hover:underline">
                  系统与更新
                </Link>
                。
              </p>
            </CardContent>
          </Card>
        </aside>

        {/* Right Column (Main) */}
        <main className="space-y-6 min-w-0">
          <section className="space-y-4" aria-labelledby="learning-tree-data-title">
            <div className="border-b border-white/10 pb-3">
              <h2 id="learning-tree-data-title" className="text-base font-semibold text-white">
                学习树数据管理
              </h2>
              <p className="mt-0.5 text-xs text-zinc-400">
                导入和导出都先预览范围，再由你明确确认后生效。
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Link
                href="/knowledge/imports?mode=export"
                className="group block min-w-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              >
                <Card
                  variant="master"
                  className="h-full transition-all duration-200 hover:border-teal-400/40 hover:shadow-[0_0_20px_rgba(45,212,191,0.12)] group-hover:bg-[#10191d]/90 p-5"
                >
                  <div className="flex items-start gap-4">
                    <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-teal-400/20 bg-teal-500/10 text-teal-300">
                      <Download className="size-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <strong className="block font-semibold text-white group-hover:text-teal-200 transition-colors">
                        导出学习树
                      </strong>
                      <CardDescription className="text-xs leading-relaxed text-zinc-400">
                        下载当前可见的科目、考纲和知识对象副本为标准 JSON。
                      </CardDescription>
                    </div>
                  </div>
                </Card>
              </Link>

              <Link
                href="/knowledge/imports?mode=import"
                className="group block min-w-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              >
                <Card
                  variant="master"
                  className="h-full transition-all duration-200 hover:border-teal-400/40 hover:shadow-[0_0_20px_rgba(45,212,191,0.12)] group-hover:bg-[#10191d]/90 p-5"
                >
                  <div className="flex items-start gap-4">
                    <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-teal-400/20 bg-teal-500/10 text-teal-300">
                      <FileInput className="size-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <strong className="block font-semibold text-white group-hover:text-teal-200 transition-colors">
                        导入学习树
                      </strong>
                      <CardDescription className="text-xs leading-relaxed text-zinc-400">
                        先核对差异与冲突，确认无误后再写入现有知识结构。
                      </CardDescription>
                    </div>
                  </div>
                </Card>
              </Link>
            </div>
          </section>

          <Card variant="subtle" className="p-5 space-y-3">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-400" aria-hidden="true" />
              <div className="space-y-1 text-xs leading-relaxed text-zinc-300">
                <strong className="block font-semibold text-white">受控恢复与数据生命周期</strong>
                <p>
                  附件通过严格的 session 与 resourceId 鉴权接口隔离访问。AI 仅在显式提交后读取白名单范围内的上下文。如需查看版本状态或触发受控更新，请前往系统中心。
                </p>
              </div>
            </div>
          </Card>
        </main>
      </div>
    </PageFrame>
  );
}
