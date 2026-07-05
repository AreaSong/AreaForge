import {
  AlertTriangle,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  Flame,
  NotebookPen,
  ShieldAlert,
  Target,
  Timer,
} from "lucide-react";
import { createDashboardSnapshot, type DashboardInput } from "@areaforge/core";
import { FocusTimer } from "@/components/focus-timer";

export const dynamic = "force-dynamic";

const finalExamDate = new Date("2027-12-20T08:30:00+08:00");
const simulationDate = new Date("2026-12-20T08:30:00+08:00");

const mockDashboard: DashboardInput = {
  targetExamDate: finalExamDate,
  simulationDate,
  todayMinutes: 135,
  effectiveMinutes: 105,
  taskCompletionRate: 0.5,
  streakDays: 2,
  missedDays: 0,
  debtCount: 3,
  daysToFinal: daysUntil(finalExamDate),
  daysToSimulation: daysUntil(simulationDate),
  tasks: [
    {
      id: "task-1",
      title: "数据结构：顺序表与链表",
      subject: "408 数据结构",
      status: "in_progress",
      estimatedMinutes: 90,
      actualMinutes: 45,
      priority: "critical",
    },
    {
      id: "task-2",
      title: "数学：函数极限基础例题",
      subject: "数学",
      status: "todo",
      estimatedMinutes: 75,
      actualMinutes: 0,
      priority: "high",
    },
    {
      id: "task-3",
      title: "英语：核心词汇 60 个",
      subject: "英语",
      status: "todo",
      estimatedMinutes: 45,
      actualMinutes: 0,
      priority: "medium",
    },
    {
      id: "task-4",
      title: "复盘：线性表错因整理",
      subject: "408 数据结构",
      status: "todo",
      estimatedMinutes: 30,
      actualMinutes: 0,
      priority: "high",
    },
  ],
};

const snapshot = createDashboardSnapshot(mockDashboard);

export default function Home() {
  return (
    <main className="min-h-screen bg-[#080b0f] text-zinc-100">
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
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricTile label="全真自测" value={`${mockDashboard.daysToSimulation} 天`} tone="amber" />
            <MetricTile label="终局考试" value={`${mockDashboard.daysToFinal} 天`} tone="teal" />
            <MetricTile label="连续打卡" value={`${mockDashboard.streakDays} 天`} tone="blue" />
            <MetricTile label="任务欠账" value={`${mockDashboard.debtCount} 项`} tone="red" />
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
          <FocusTimer
            subject="408 数据结构"
            taskTitle="顺序表与链表"
            syllabusNode="线性表 / 链表基本操作"
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
          </aside>
        </section>

        <section className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-lg border border-white/10 bg-[#101419] p-5">
            <SectionTitle icon={Target} title="今日任务" />
            <div className="mt-4 grid gap-3">
              {snapshot.topTasks.map((task) => (
                <article key={task.id} className="rounded-md border border-white/10 bg-[#151a20] p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm text-zinc-400">{task.subject}</p>
                      <h2 className="mt-1 font-medium text-white">{task.title}</h2>
                    </div>
                    <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-zinc-300">
                      {task.estimatedMinutes} 分钟
                    </span>
                  </div>
                  <div className="mt-4 h-2 rounded-md bg-white/10">
                    <div
                      className="h-2 rounded-md bg-teal-400"
                      style={{
                        width: `${Math.min(100, Math.round((task.actualMinutes / task.estimatedMinutes) * 100))}%`,
                      }}
                    />
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#101419] p-5">
            <SectionTitle icon={BookOpen} title="考纲作战地图" />
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["数学", 8, "bg-sky-400"],
                ["英语", 12, "bg-teal-400"],
                ["数据结构", 18, "bg-amber-300"],
                ["组成原理", 3, "bg-red-400"],
                ["操作系统", 0, "bg-zinc-500"],
                ["计算机网络", 0, "bg-zinc-500"],
                ["政治", 0, "bg-zinc-500"],
                ["错题复盘", 6, "bg-violet-300"],
              ].map(([label, progress, color]) => (
                <div key={label} className="rounded-md border border-white/10 bg-[#151a20] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-zinc-300">{label}</span>
                    <span className="text-xs text-zinc-500">{progress}%</span>
                  </div>
                  <div className="mt-3 h-2 rounded-md bg-white/10">
                    <div className={`h-2 rounded-md ${color}`} style={{ width: `${progress}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-5 md:grid-cols-3">
          <SignalPanel icon={CheckCircle2} title="反假学习" value="1 次低转化待补产出" />
          <SignalPanel icon={NotebookPen} title="晚间复盘" value="还未提交今日复盘" />
          <SignalPanel icon={BrainCircuit} title="AI 建议" value="结束计时后生成明日最小任务" />
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
  tone: "amber" | "teal" | "blue" | "red";
}) {
  const toneClass = {
    amber: "text-amber-200 border-amber-300/25 bg-amber-300/10",
    teal: "text-teal-200 border-teal-300/25 bg-teal-300/10",
    blue: "text-sky-200 border-sky-300/25 bg-sky-300/10",
    red: "text-red-200 border-red-300/25 bg-red-300/10",
  }[tone];

  return (
    <div className={`rounded-lg border px-4 py-3 ${toneClass}`}>
      <p className="text-xs opacity-75">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  title,
}: {
  icon: typeof Timer;
  title: string;
}) {
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
  icon: typeof AlertTriangle;
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

function daysUntil(date: Date): number {
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / 86_400_000));
}

