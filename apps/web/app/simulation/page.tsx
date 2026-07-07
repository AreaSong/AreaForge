import {
  ArrowLeft,
  BrainCircuit,
  CalendarClock,
  ListChecks,
  Target,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SimulationWorkbench } from "@/components/simulation-workbench";
import { getCurrentUser } from "@/lib/auth/session";
import { getSimulationWorkspace } from "@/lib/study/simulation-service";
import { listSubjects } from "@/lib/study/service";

export const dynamic = "force-dynamic";

export default async function SimulationPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [subjects, workspace] = await Promise.all([
    listSubjects(),
    getSimulationWorkspace(),
  ]);

  return (
    <main className="min-h-screen bg-[#080b0f] text-zinc-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3 text-sm text-amber-300">
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
              <span>AreaForge / Simulation</span>
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white sm:text-4xl">
              全真模拟考试
            </h1>
            <p className="mt-2 text-sm text-zinc-500">2026 同步自测阶段节点，本地规则草稿，不默认调用 AI。</p>
          </div>
          <Link
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/10"
            href="/"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            返回作战台
          </Link>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric icon={CalendarClock} label="阶段节点" value={`${workspace.stage.simulationNode.daysToSimulation} 天`} sub={formatDate(workspace.stage.simulationNode.date)} />
          <Metric icon={Target} label="准备度" value={`${workspace.stage.readiness.score} 分`} sub={labelReadiness(workspace.stage.readiness.level)} />
          <Metric
            icon={ListChecks}
            label="模拟记录"
            value={`${workspace.exams.length + workspace.tasks.length} 条`}
            sub={`${workspace.exams.length} 条结构化 / ${workspace.tasks.length} 条旧记录`}
          />
          <Metric icon={BrainCircuit} label="草稿状态" value={labelDraftRisk(workspace.stage.draft.risk)} sub={workspace.stage.draft.canAutoApply ? "可直接应用" : "只生成建议，不自动应用"} />
        </section>

        <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-lg border border-white/10 bg-[#101419] p-5">
            <h2 className="text-lg font-semibold text-white">阶段调整草稿</h2>
            <div className="mt-5 grid gap-3">
              <p className="rounded-md border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-50">
                {workspace.stage.draft.riskConclusion}
              </p>
              <p className="rounded-md border border-sky-300/20 bg-sky-300/10 px-4 py-3 text-sm leading-6 text-sky-50">
                {workspace.stage.draft.intensityAdjustment}
              </p>
              <p className="rounded-md border border-white/10 bg-[#151a20] px-4 py-3 text-sm leading-6 text-zinc-200">
                任务强度：{labelTaskIntensity(workspace.stage.draft.taskIntensity)} / 应用边界：{workspace.stage.draft.requiresUserConfirmation ? "需要用户确认" : "无需确认"}
              </p>
              <div className="rounded-md border border-white/10 bg-[#151a20] p-4">
                <p className="text-sm text-zinc-400">重点科目</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {workspace.stage.draft.focusSubjects.map((subject) => (
                    <span key={subject} className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-200">
                      {subject}
                    </span>
                  ))}
                </div>
              </div>
              <p className="rounded-md border border-violet-300/20 bg-violet-300/10 px-4 py-3 text-sm leading-6 text-violet-50">
                {workspace.stage.draft.privacyBoundary}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#101419] p-5">
            <h2 className="text-lg font-semibold text-white">下一步动作</h2>
            <div className="mt-5 grid gap-3">
              <p className="rounded-md border border-white/10 bg-[#151a20] px-4 py-3 text-sm leading-6 text-zinc-200">
                {workspace.stage.readiness.reason}
              </p>
              {workspace.stage.draft.taskActions.map((action) => (
                <p key={action} className="rounded-md border border-teal-300/20 bg-teal-300/10 px-4 py-3 text-sm leading-6 text-teal-50">
                  {action}
                </p>
              ))}
            </div>
          </div>
        </section>

        <SimulationWorkbench
          subjects={subjects}
          exams={workspace.exams}
          tasks={workspace.tasks}
          stage={workspace.stage}
          motivationVault={workspace.motivationVault}
        />
      </div>
    </main>
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
      <Icon className="h-5 w-5 text-amber-300" aria-hidden="true" />
      <p className="mt-4 text-sm text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{sub}</p>
    </div>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("zh-CN");
}

function labelReadiness(level: string): string {
  switch (level) {
    case "simulation_window":
      return "自测窗口";
    case "ready":
      return "可进入模拟";
    case "warming_up":
      return "准备中";
    case "not_ready":
      return "先恢复闭环";
    default:
      return "未知";
  }
}

function labelDraftRisk(risk: string): string {
  switch (risk) {
    case "low":
      return "低风险";
    case "medium":
      return "中风险";
    case "high":
      return "高风险";
    case "critical":
      return "严重风险";
    default:
      return "本地规则";
  }
}

function labelTaskIntensity(intensity: string): string {
  switch (intensity) {
    case "reduce":
      return "降载";
    case "keep":
      return "维持";
    case "increase":
      return "加压";
    case "sprint":
      return "冲刺";
    default:
      return "未知";
  }
}
