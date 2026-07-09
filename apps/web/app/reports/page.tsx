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
import { ReportDecisionActions } from "@/components/report-decision-actions";
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
            <p className="mt-2 text-sm text-zinc-500">实时派生报告，确认后冻结快照并保留只读回放。</p>
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
            <div className="mb-3 flex flex-wrap gap-2">
              <span className="rounded-md border border-amber-200/20 px-2 py-1 text-xs text-amber-50">
                {labelWeaknessSource(report.weakness.source)}
              </span>
              <span className="rounded-md border border-amber-200/20 px-2 py-1 text-xs text-amber-50">
                {labelWeaknessSeverity(report.weakness.severity)}
              </span>
            </div>
            <h4 className="font-medium text-white">{report.weakness.title}</h4>
            <p className="mt-2 text-sm leading-6 text-amber-50">{report.weakness.detail}</p>
            {report.weakness.syllabusNodeTitle ? (
              <p className="mt-2 text-xs text-amber-100/70">节点：{report.weakness.syllabusNodeTitle}</p>
            ) : null}
            <div className="mt-3 grid gap-2">
              {report.weakness.reasons.map((reason) => (
                <p key={reason} className="rounded-md border border-amber-200/10 bg-black/10 px-3 py-2 text-xs leading-5 text-amber-50/90">
                  {reason}
                </p>
              ))}
            </div>
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
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-white">阶段策略</h3>
            <span className="rounded-md border border-sky-200/20 px-2 py-1 text-xs text-sky-100">
              {report.strategy.canAutoApply ? "可自动应用" : "只读建议"}
            </span>
            <span className="rounded-md border border-sky-200/20 px-2 py-1 text-xs text-sky-100">
              {report.strategy.requiresUserConfirmation ? "需确认" : "无需确认"}
            </span>
          </div>
          <div className="mt-5 grid gap-3">
            <p className="rounded-md border border-sky-300/20 bg-sky-300/10 px-4 py-3 text-sm leading-6 text-sky-50">
              {labelTheme(report.strategy.theme)}：{report.strategy.stageAdjustment}
            </p>
            <p className="rounded-md border border-white/10 bg-[#151a20] px-4 py-3 text-sm leading-6 text-zinc-200">
              {report.strategy.calmConclusion}
            </p>
            <div className="rounded-md border border-white/10 bg-[#151a20] px-4 py-3 text-sm leading-6 text-zinc-200">
              <p className="text-xs text-zinc-500">持久阶段边界</p>
              <p className="mt-1">
                {report.stagePersistence.latestPlan
                  ? `${report.stagePersistence.latestPlan.name} / ${labelPersistentStageMode(report.stagePersistence.latestPlan.mode)}`
                  : "尚未保存阶段计划"}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {report.stagePersistence.latestDraft
                  ? `最近草稿：${labelPersistentDraftStatus(report.stagePersistence.latestDraft.status)}，${report.stagePersistence.latestDraft.requiresUserConfirmation ? "需确认" : "无需确认"}，${report.stagePersistence.latestDraft.canAutoApply ? "可自动应用" : "不自动应用"}`
                  : "尚无持久阶段调整草稿"}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                API：{report.stagePersistence.planApiPath} / {report.stagePersistence.draftApiPath}
              </p>
            </div>
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
          <div className="flex flex-wrap items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-violet-300" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-white">复盘建议草稿</h3>
            <span className="rounded-md border border-violet-200/20 px-2 py-1 text-xs text-violet-100">
              {report.aiDraft.canAutoApply ? "可自动应用" : "只读建议"}
            </span>
            <span className="rounded-md border border-violet-200/20 px-2 py-1 text-xs text-violet-100">
              {report.aiDraft.requiresUserConfirmation ? "需确认" : "无需确认"}
            </span>
          </div>
          <div className="mt-5 rounded-md border border-violet-300/20 bg-violet-300/10 p-4">
            <p className="text-sm text-violet-100">{report.aiDraft.title}</p>
            <p className="mt-2 text-sm leading-6 text-violet-50">{report.aiDraft.content}</p>
            <p className="mt-3 text-xs leading-5 text-violet-100/70">{report.aiDraft.reason}</p>
          </div>
          <div className="mt-4 rounded-md border border-white/10 bg-[#151a20] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-zinc-100">{report.decisionPreview.nextCycleDraft.title}</p>
              <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300">
                {report.decisionPreview.canAutoApply ? "可自动应用" : "只读预览"}
              </span>
              <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300">
                {report.decisionPreview.requiresUserConfirmation ? "需确认" : "无需确认"}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-zinc-200">{report.decisionPreview.nextCycleDraft.focus}</p>
            <div className="mt-3 grid gap-2">
              {report.decisionPreview.nextCycleDraft.actions.map((action) => (
                <p key={action} className="text-xs leading-5 text-zinc-400">
                  {action}
                </p>
              ))}
            </div>
            <p className="mt-3 text-xs leading-5 text-zinc-500">
              {report.decisionPreview.nextCycleDraft.reason}
            </p>
          </div>
          <ReportDecisionActions report={report} />
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

function labelPersistentStageMode(mode: NonNullable<PeriodicReportDto["stagePersistence"]["latestPlan"]>["mode"]): string {
  switch (mode) {
    case "recovery":
      return "恢复";
    case "strengthen":
      return "强化";
    case "sprint":
      return "冲刺";
    case "maintain":
      return "维持";
  }
}

function labelPersistentDraftStatus(status: NonNullable<PeriodicReportDto["stagePersistence"]["latestDraft"]>["status"]): string {
  switch (status) {
    case "draft":
      return "待确认";
    case "applied":
      return "已应用";
    case "rejected":
      return "已驳回";
  }
}

function labelWeaknessSource(source: PeriodicReportDto["weakness"]["source"]): string {
  switch (source) {
    case "syllabus_node":
      return "来源：考纲节点";
    case "debt_subject":
      return "来源：欠账科目";
    case "zero_effective_subject":
      return "来源：投入缺口";
    case "low_conversion":
      return "来源：低转化";
    case "none":
      return "来源：稳态";
  }
}

function labelWeaknessSeverity(severity: PeriodicReportDto["weakness"]["severity"]): string {
  switch (severity) {
    case "critical":
      return "级别：严重";
    case "high":
      return "级别：偏高";
    case "medium":
      return "级别：中等";
    case "low":
      return "级别：轻微";
    case "clear":
      return "级别：清晰";
  }
}
