import { Download, FileInput, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageFrame, PageHeader, SectionHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/batch7";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/settings/data");

export default async function SettingsDataPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <PageFrame variant="dashboard-wide" className="space-y-10">
      <PageHeader
        eyebrow="设置 / 数据与安全"
        title="数据与安全"
        description="管理学习树的导入导出入口，了解数据边界和恢复原则。删除、迁移与生产备份仍由受控运维流程处理。"
      />
      <section className="space-y-4">
        <SectionHeader title="学习树数据" description="导入和导出都先预览范围，再由你明确确认。" />
        <div className="grid gap-3 md:grid-cols-2">
          <Link href="/knowledge/imports?mode=export" className="group flex min-h-32 items-start gap-3 rounded-md border border-white/10 bg-white/[0.02] p-4 hover:border-teal-300/40 hover:bg-white/[0.04]">
            <Download className="mt-0.5 h-5 w-5 shrink-0 text-teal-300" aria-hidden="true" />
            <span><strong className="font-medium text-white group-hover:text-teal-200">导出学习树</strong><span className="mt-1 block text-sm leading-6 text-zinc-400">下载当前可见的科目、考纲和知识对象副本。</span></span>
          </Link>
          <Link href="/knowledge/imports?mode=import" className="group flex min-h-32 items-start gap-3 rounded-md border border-white/10 bg-white/[0.02] p-4 hover:border-teal-300/40 hover:bg-white/[0.04]">
            <FileInput className="mt-0.5 h-5 w-5 shrink-0 text-teal-300" aria-hidden="true" />
            <span><strong className="font-medium text-white group-hover:text-teal-200">导入学习树</strong><span className="mt-1 block text-sm leading-6 text-zinc-400">先核对差异，再确认写入现有知识结构。</span></span>
          </Link>
        </div>
      </section>
      <section className="space-y-4 border-t border-white/10 pt-8">
        <SectionHeader title="边界与恢复" description="应用层不会直接执行数据库清理、备份恢复或服务器命令。" />
        <div className="flex items-start gap-3 rounded-md border border-white/10 bg-white/[0.02] p-4 text-sm leading-6 text-zinc-400">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
          <p>附件通过鉴权接口访问，AI 只在显式提交后读取允许的上下文。需要检查运行状态时，请前往 <Link href="/settings/system" className="text-teal-300 hover:underline">系统与更新</Link>。</p>
        </div>
      </section>
    </PageFrame>
  );
}
