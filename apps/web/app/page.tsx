import {
  AlertTriangle,
  AlertCircle,
  Archive,
  BarChart3,
  BookOpen,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  Flame,
  NotebookPen,
  NotebookText,
  ShieldAlert,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FocusTimer } from "@/components/focus-timer";
import { LogoutButton } from "@/components/logout-button";
import { ReviewForm } from "@/components/review-form";
import { TaskPanel } from "@/components/task-panel";
import { getCurrentUser } from "@/lib/auth/session";
import { getDailyReviewAiAdvice, getTomorrowPlanAiAdvice } from "@/lib/study/ai-service";
import { getTodayDashboard } from "@/lib/study/service";
import { listSyllabusTree } from "@/lib/study/syllabus-service";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [dashboard, syllabusNodes, dailyReviewAdvice, tomorrowPlanAdvice] = await Promise.all([
    getTodayDashboard(),
    listSyllabusTree(),
    getDailyReviewAiAdvice(),
    getTomorrowPlanAiAdvice(),
  ]);
  const { metrics, snapshot } = dashboard;
  const themeClass = getThemeShellClass(snapshot.themeState);

  return (
    <main className={`min-h-screen text-zinc-100 ${themeClass}`}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-3 text-sm text-teal-300">
              <Flame className="h-4 w-4" aria-hidden="true" />
              <span>AreaForge</span>
              <span className="rounded-md border border-teal-400/30 px-2 py-1 text-xs text-teal-100">
                {labelRisk(snapshot.riskState)}
              </span>
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
              今日作战台
            </h1>
            <p className="mt-2 text-sm text-zinc-500">{dashboard.studyDay.key} / Asia Shanghai</p>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-end gap-3">
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10"
                href="/syllabus"
              >
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                考纲
              </Link>
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10"
                href="/notes"
              >
                <NotebookPen className="h-4 w-4" aria-hidden="true" />
                笔记
              </Link>
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10"
                href="/mistakes"
              >
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                错题
              </Link>
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10"
                href="/motivation"
              >
                <Archive className="h-4 w-4" aria-hidden="true" />
                动机
              </Link>
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10"
                href="/analytics"
              >
                <BarChart3 className="h-4 w-4" aria-hidden="true" />
                统计
              </Link>
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10"
                href="/reports"
              >
                <NotebookText className="h-4 w-4" aria-hidden="true" />
                报告
              </Link>
              <Link
                className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10"
                href="/simulation"
              >
                <CalendarClock className="h-4 w-4" aria-hidden="true" />
                模拟
              </Link>
              <span className="text-sm text-zinc-400">{user.email}</span>
              <LogoutButton />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <MetricTile label="全真自测" value={`${metrics.daysToSimulation} 天`} tone="amber" />
              <MetricTile label="终局考试" value={`${metrics.daysToFinal} 天`} tone="teal" />
              <MetricTile label="连续打卡" value={`${metrics.streakDays} 天`} tone="blue" />
              <MetricTile label="任务欠账" value={`${metrics.debtCount} 项`} tone="red" />
              <MetricTile label="阶段称号" value={dashboard.stage.title} tone="violet" />
            </div>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
          <FocusTimer
            key={dashboard.activeSession?.id ?? "idle"}
            subjects={dashboard.subjects}
            tasks={dashboard.tasks}
            syllabusNodes={syllabusNodes}
            activeSession={dashboard.activeSession}
          />

          <aside className="rounded-lg border border-white/10 bg-[#101419] p-5">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-1 h-5 w-5 text-amber-300" aria-hidden="true" />
              <div>
                <p className="text-sm text-zinc-400">今日鞭策</p>
                <p className="mt-2 text-lg leading-8 text-white">{snapshot.disciplineLine}</p>
              </div>
            </div>
            <div className="mt-5 rounded-md border border-teal-400/20 bg-teal-400/10 p-4">
              <p className="text-sm text-teal-200">下一步</p>
              <p className="mt-2 leading-7 text-teal-50">{snapshot.nextAction}</p>
            </div>
            <div className="mt-5 rounded-md border border-sky-300/20 bg-sky-300/10 p-4">
              <div className="flex items-center gap-2 text-sky-100">
                <Trophy className="h-4 w-4" aria-hidden="true" />
                <p className="text-sm">阶段状态：{dashboard.stage.title}</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-sky-50">{dashboard.stage.reason}</p>
              <p className="mt-2 text-xs text-sky-100/70">阶段分 {dashboard.stage.score} / 压强 {labelPressure(dashboard.stage.pressure)}</p>
            </div>
            {dashboard.recovery.active ? (
              <div className="mt-5 rounded-md border border-amber-300/25 bg-amber-300/10 p-4">
                <p className="text-sm text-amber-200">恢复模式</p>
                <p className="mt-2 leading-7 text-amber-50">{dashboard.recovery.action}</p>
                <p className="mt-2 text-xs text-amber-100/75">{dashboard.recovery.reason}</p>
              </div>
            ) : null}
            {dashboard.motivationWake.shouldWake ? (
              <div className="mt-5 rounded-md border border-rose-300/25 bg-rose-300/10 p-4">
                <div className="flex items-center gap-2 text-rose-100">
                  <Archive className="h-4 w-4" aria-hidden="true" />
                  <p className="text-sm">动机唤醒</p>
                </div>
                <p className="mt-2 text-sm leading-6 text-rose-50">{dashboard.motivationWake.message}</p>
                <Link className="mt-3 inline-flex text-sm text-rose-100 underline-offset-4 hover:underline" href="/motivation">
                  打开动机封存
                </Link>
              </div>
            ) : null}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <MetricTile label="今日投入" value={`${metrics.todayMinutes} 分`} tone="teal" />
              <MetricTile label="有效学习" value={`${metrics.effectiveMinutes} 分`} tone="blue" />
            </div>
          </aside>
        </section>

        <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
          <TaskPanel subjects={dashboard.subjects} tasks={dashboard.tasks} syllabusNodes={syllabusNodes} />

          <div className="rounded-lg border border-white/10 bg-[#101419] p-5">
            <SectionTitle icon={BookOpen} title="考纲作战地图" />
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {dashboard.syllabusOverview.map((item) => (
                <div key={item.label} className="rounded-md border border-white/10 bg-[#151a20] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-zinc-300">{item.label}</span>
                    <span className="text-xs text-zinc-500">{item.progress}%</span>
                  </div>
                  <div className="mt-3 h-2 rounded-md bg-white/10">
                    <div className="h-2 rounded-md" style={{ width: `${item.progress}%`, backgroundColor: item.color }} />
                  </div>
                </div>
              ))}
            </div>
            {dashboard.debtTasks.length > 0 ? (
              <div className="mt-5 rounded-md border border-amber-300/20 bg-amber-300/10 p-4">
                <p className="text-sm text-amber-200">欠账预览</p>
                <div className="mt-3 grid gap-2">
                  {dashboard.debtTasks.map((task) => (
                    <div key={task.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-amber-50">{task.title}</span>
                      <span className="shrink-0 text-xs text-amber-100/70">{task.subjectName}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <ReviewForm review={dashboard.review} />
          <div className="grid gap-5">
            <article className="rounded-lg border border-violet-300/20 bg-violet-300/10 p-5">
              <div className="flex items-center gap-2 text-violet-100">
                <BrainCircuit className="h-5 w-5" aria-hidden="true" />
                <h2 className="text-lg font-semibold text-white">AI 建议草稿</h2>
              </div>
              <div className="mt-4 grid gap-3">
                <div className="rounded-md border border-white/10 bg-[#151a20] p-4">
                  <p className="text-sm text-violet-100">{dailyReviewAdvice.advice.title}</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-200">{dailyReviewAdvice.advice.nextReviewPrompt}</p>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">{dailyReviewAdvice.meta.reason}</p>
                </div>
                <div className="rounded-md border border-white/10 bg-[#151a20] p-4">
                  <p className="text-sm text-violet-100">{tomorrowPlanAdvice.advice.title}</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-200">{tomorrowPlanAdvice.advice.minimumTaskTitle}</p>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">
                    {tomorrowPlanAdvice.advice.estimatedMinutes} 分钟 / {labelPriority(tomorrowPlanAdvice.advice.priority)}
                  </p>
                </div>
              </div>
            </article>
            <SignalPanel icon={CheckCircle2} title="打卡连续性" value={dashboard.checkIn.reason} />
            <SignalPanel icon={CheckCircle2} title="反假学习" value={dashboard.signals.antiFake} />
            <SignalPanel icon={AlertCircle} title="情绪状态" value={dashboard.review?.mood ? `今日记录：${dashboard.review.mood}` : "晚间复盘可以记录今天的状态标签"} />
            <SignalPanel icon={BarChart3} title="统计复核" value="统计页会按近 7 天数据库记录复核投入、完成率、复盘率和薄弱提醒" />
            <SignalPanel icon={AlertTriangle} title="晚间复盘" value={dashboard.signals.review} />
            <SignalPanel icon={BrainCircuit} title="AI 建议" value={dashboard.signals.ai} />
          </div>
        </section>
      </div>
    </main>
  );
}

function MetricTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "amber" | "teal" | "blue" | "red" | "violet";
}) {
  const toneClass = {
    amber: "text-amber-200 border-amber-300/25 bg-amber-300/10",
    teal: "text-teal-200 border-teal-300/25 bg-teal-300/10",
    blue: "text-sky-200 border-sky-300/25 bg-sky-300/10",
    red: "text-red-200 border-red-300/25 bg-red-300/10",
    violet: "text-violet-200 border-violet-300/25 bg-violet-300/10",
  }[tone];

  return (
    <div className={`rounded-lg border px-4 py-3 ${toneClass}`}>
      <p className="text-xs opacity-75">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-5 w-5 text-teal-300" aria-hidden="true" />
      <h2 className="text-lg font-semibold text-white">{title}</h2>
    </div>
  );
}

function SignalPanel({
  icon: Icon,
  title,
  value,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
}) {
  return (
    <article className="rounded-lg border border-white/10 bg-[#101419] p-5">
      <Icon className="h-5 w-5 text-amber-300" aria-hidden="true" />
      <p className="mt-4 text-sm text-zinc-400">{title}</p>
      <p className="mt-2 leading-7 text-white">{value}</p>
    </article>
  );
}

function labelPressure(pressure: string): string {
  switch (pressure) {
    case "low":
      return "低";
    case "medium":
      return "中";
    case "high":
      return "高";
    case "sprint":
      return "冲刺";
    default:
      return "未知";
  }
}

function labelRisk(riskState: string): string {
  switch (riskState) {
    case "rising":
      return "上升期";
    case "stable":
      return "稳定期";
    case "volatile":
      return "波动期";
    case "lost":
      return "失守期";
    case "danger":
      return "危险期";
    case "sprint":
      return "冲刺期";
    default:
      return "正常";
  }
}

function labelPriority(priority: string): string {
  switch (priority) {
    case "critical":
      return "最高";
    case "high":
      return "高";
    case "medium":
      return "中";
    case "low":
      return "低";
    default:
      return "未知";
  }
}

function getThemeShellClass(themeState: string): string {
  switch (themeState) {
    case "forge":
      return "bg-[#090d0b]";
    case "alert":
      return "bg-[#0d0b09]";
    case "recovery":
      return "bg-[#0b0c10]";
    case "sprint":
      return "bg-[#0b0a0e]";
    default:
      return "bg-[#080b0f]";
  }
}
