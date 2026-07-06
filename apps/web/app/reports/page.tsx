import {
  ArrowLeft,
  BarChart3,
  BrainCircuit,
  Clock3,
  FileWarning,
  ListChecks,
  NotebookText,
  Target,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getPeriodicReports, type PeriodicReportDto } from "@/lib/study/reports-service";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const reports = await getPeriodicReports();

  return (
    <main className="min-h-screen bg-[#080b0f] text-zinc-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3 text-sm text-teal-300">
              <NotebookText className="h-4 w-4" aria-hidden="true" />
              <span>AreaForge / Reports</span>
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
              周审判与月复盘
            </h1>
            <p className="mt-2 text-sm text-zinc-500">即时派生报告，不落库，不默认调用 AI。</p>
          </div>
          <Link
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10"
            href="/"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            返回作战台
          </Link>
        </header>

        <ReportSection report={reports.week} />
        <ReportSection report={reports.month} />
      </div>
    </main>
  );
}

function ReportSection({ report }: { report: PeriodicReportDto }) {
  return (
    <section className="grid gap-5 border-t border-white/10 pt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-teal-300">{formatDate(report.range.start)} 至 {formatExclusiveEndDate(report.range.end)}</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{report.title}</h2>
        </div>
        <span className="w-fit rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-300">
          {report.range.days} 个学习日口径
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric icon={Clock3} label="总学习时长" value={`${report.metrics.totalMinutes} 分`} sub={`有效 ${report.metrics.effectiveMinutes} 分`} />
        <Metric icon={ListChecks} label="任务完成率" value={formatPercent(report.metrics.taskCompletionRate)} sub={`${report.metrics.completedTaskCount}/${report.metrics.taskCount} 项`} />
        <Metric icon={FileWarning} label="欠账与低转化" value={`${report.metrics.debtCount} / ${report.metrics.lowConversionCount}`} sub="欠账 / 低转化次数" />
        <Metric icon={NotebookText} label="复盘与错题" value={formatPercent(report.metrics.reviewCompletionRate)} sub={`复盘 ${report.metrics.reviewCount} 次，新增错题 ${report.metrics.mistakesCreatedCount}`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-white/10 bg-[#101419] p-5">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-teal-300" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-white">科目投入与产出</h3>
          </div>
          <div className="mt-5 grid gap-3">
            {report.subjectShares.map((subject) => (
              <div key={subject.subjectId} className="rounded-md border border-white/10 bg-[#151a20] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-zinc-200">{subject.subjectName}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      有效 {subject.effectiveMinutes} 分 · 欠账 {subject.debtCount} · 错题 {subject.mistakeCount}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm text-zinc-300">{subject.share}%</span>
                </div>
                <div className="mt-3 h-2 rounded-md bg-white/10">
                  <div className="h-2 rounded-md" style={{ width: `${subject.share}%`, backgroundColor: subject.subjectColor }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#101419] p-5">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-amber-300" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-white">最大短板</h3>
          </div>
          <div className="mt-5 rounded-md border border-amber-300/20 bg-amber-300/10 p-4">
            <h4 className="font-medium text-white">{report.weakness.title}</h4>
            <p className="mt-2 text-sm leading-6 text-amber-50">{report.weakness.detail}</p>
            {report.weakness.syllabusNodeTitle ? (
              <p className="mt-2 text-xs text-amber-100/70">节点：{report.weakness.syllabusNodeTitle}</p>
            ) : null}
          </div>

          <div className="mt-5 grid gap-3">
            <h4 className="font-medium text-white">下周期必须压住</h4>
            <p className="rounded-md border border-teal-300/20 bg-teal-300/10 px-4 py-3 text-sm leading-6 text-teal-50">
              {report.strategy.mustPressIssue}
            </p>
            {report.strategy.nextActions.map((action) => (
              <p key={action} className="rounded-md border border-white/10 bg-[#151a20] px-4 py-3 text-sm leading-6 text-zinc-200">
                {action}
              </p>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-lg border border-white/10 bg-[#101419] p-5">
          <h3 className="text-lg font-semibold text-white">阶段策略</h3>
          <div className="mt-5 grid gap-3">
            <p className="rounded-md border border-sky-300/20 bg-sky-300/10 px-4 py-3 text-sm leading-6 text-sky-50">
              {labelTheme(report.strategy.theme)}：{report.strategy.stageAdjustment}
            </p>
            <p className="rounded-md border border-white/10 bg-[#151a20] px-4 py-3 text-sm leading-6 text-zinc-200">
              {report.strategy.calmConclusion}
            </p>
          </div>
          {report.debtPreview.length > 0 ? (
            <div className="mt-5 grid gap-2">
              <p className="text-sm text-zinc-400">欠账预览</p>
              {report.debtPreview.map((task) => (
                <div key={task.id} className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-[#151a20] px-3 py-2 text-sm">
                  <span className="truncate text-zinc-200">{task.title}</span>
                  <span className="shrink-0 text-xs text-zinc-500">{task.subjectName}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-white/10 bg-[#101419] p-5">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-violet-300" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-white">复盘建议草稿</h3>
          </div>
          <div className="mt-5 rounded-md border border-violet-300/20 bg-violet-300/10 p-4">
            <p className="text-sm text-violet-100">{report.aiDraft.title}</p>
            <p className="mt-2 text-sm leading-6 text-violet-50">{report.aiDraft.content}</p>
            <p className="mt-3 text-xs leading-5 text-violet-100/70">{report.aiDraft.reason}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#101419] p-4">
      <Icon className="h-5 w-5 text-teal-300" aria-hidden="true" />
      <p className="mt-4 text-sm text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{sub}</p>
    </div>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("zh-CN");
}

function formatExclusiveEndDate(value: string): string {
  return new Date(new Date(value).getTime() - 1).toLocaleDateString("zh-CN");
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function labelTheme(theme: PeriodicReportDto["strategy"]["theme"]): string {
  switch (theme) {
    case "recovery":
      return "恢复主题";
    case "strengthening":
      return "强化主题";
    case "sprint":
      return "冲刺主题";
    case "steady":
      return "稳态推进";
  }
}
