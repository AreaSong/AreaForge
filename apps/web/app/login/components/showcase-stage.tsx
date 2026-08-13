import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, Check, CircleAlert, LockKeyhole, Sparkles } from "lucide-react";
import type { LearningLoopNode, LearningLoopScene } from "../constants/learning-loop";

interface ShowcaseStageProps {
  node: LearningLoopNode;
  paused: boolean;
}

export function ShowcaseStage({ node, paused }: ShowcaseStageProps) {
  const style = {
    "--af-route-accent": node.accent,
    "--af-route-accent-soft": node.accentSoft,
  } as CSSProperties;

  return (
    <section
      aria-label={`学习闭环第 ${node.step} 步：${node.navTitle}`}
      className="af-learning-route relative flex h-full min-h-[560px] flex-col overflow-hidden border-y border-white/10 py-7 lg:min-h-[520px] lg:py-8"
      data-paused={paused ? "true" : "false"}
      style={style}
    >
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_72%_45%,var(--af-route-accent-soft),transparent_42%)]" />
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--af-route-accent)] to-transparent opacity-50" />

      <div className="relative z-10 grid flex-1 gap-7 xl:grid-cols-[minmax(250px,0.72fr)_minmax(420px,1.28fr)] xl:items-center">
        <div className="af-stage-copy max-w-xl px-2 lg:px-5">
          <div className="flex items-center gap-3 text-xs font-medium text-zinc-400">
            <span className="font-mono text-[var(--af-route-accent)]">STEP {String(node.step).padStart(2, "0")} / 06</span>
            <span aria-hidden className="h-px w-8 bg-white/15" />
            <span>{node.kicker}</span>
          </div>

          <h2 className="mt-5 max-w-lg text-3xl font-semibold leading-tight text-white xl:text-4xl">
            {node.title}
          </h2>
          <p className="mt-4 max-w-lg text-sm leading-7 text-zinc-400 xl:text-base">
            {node.desc}
          </p>

          <div className="mt-7 border-l-2 pl-4" style={{ borderColor: node.accent }}>
            <p className="text-xs text-zinc-500">{node.inputLabel}</p>
            <p className="mt-1 text-sm font-medium text-zinc-100">{node.inputValue}</p>
          </div>
        </div>

        <div className="af-stage-visual min-w-0 px-2 lg:px-5">
          <SceneFrame node={node}>
            <StageScene scene={node.scene} />
          </SceneFrame>
        </div>
      </div>

      <FlowHandoff node={node} />
    </section>
  );
}

function SceneFrame({ node, children }: { node: LearningLoopNode; children: ReactNode }) {
  const Icon = node.icon;
  return (
    <div className="relative overflow-hidden rounded-lg border border-white/10 bg-[#080d12]/88 shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
      <div className="flex h-11 items-center justify-between border-b border-white/10 px-4">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Icon aria-hidden size={15} style={{ color: node.accent }} />
          <span>{node.navTitle}</span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-600">
          <span aria-hidden className="af-learning-motion size-1.5 rounded-full bg-[var(--af-route-accent)] shadow-[0_0_10px_var(--af-route-accent)]" />
          LIVE FLOW
        </div>
      </div>
      <div className="relative min-h-[280px] p-5 xl:min-h-[310px] xl:p-6">{children}</div>
    </div>
  );
}

function StageScene({ scene }: { scene: LearningLoopScene }) {
  switch (scene) {
    case "select":
      return <SelectScene />;
    case "timer":
      return <TimerScene />;
    case "capture":
      return <CaptureScene />;
    case "proof":
      return <ProofScene />;
    case "summary":
      return <SummaryScene />;
    case "trend":
      return <TrendScene />;
  }
}

function SelectScene() {
  const subjects = [
    { name: "高等数学", meta: "极限定义 · 当前目标", active: true },
    { name: "408", meta: "数据结构 · 稍后继续", active: false },
    { name: "英语", meta: "阅读理解 · 待安排", active: false },
  ];

  return (
    <div className="grid h-full gap-5 md:grid-cols-[1fr_0.88fr]">
      <div className="divide-y divide-white/10 border-y border-white/10">
        {subjects.map((subject, index) => (
          <div
            className={`af-scene-row flex items-center gap-3 py-3.5 ${subject.active ? "text-white" : "text-zinc-500"}`}
            key={subject.name}
            style={{ animationDelay: `${index * 110}ms` }}
          >
            <span
              aria-hidden
              className={`grid size-7 place-items-center rounded-md border ${subject.active ? "border-[var(--af-route-accent)] bg-[var(--af-route-accent-soft)]" : "border-white/10"}`}
            >
              {subject.active ? <Check size={14} /> : <span className="size-1.5 rounded-full bg-zinc-700" />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{subject.name}</span>
              <span className="mt-0.5 block truncate text-xs text-zinc-600">{subject.meta}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-col justify-between border-l border-white/10 pl-5">
        <div>
          <p className="text-xs text-zinc-500">本次边界</p>
          <p className="mt-2 text-lg font-medium text-zinc-100">说清极限定义</p>
          <p className="mt-2 text-xs leading-6 text-zinc-500">暂不展开极限运算法则，先建立 ε-δ 语言的直觉。</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--af-route-accent)]">
          <LockKeyhole aria-hidden size={14} />
          学习意图已锁定
        </div>
      </div>
    </div>
  );
}

function TimerScene() {
  return (
    <div className="grid min-h-[240px] place-items-center md:grid-cols-[0.9fr_1.1fr]">
      <div className="relative grid size-44 place-items-center rounded-full border border-white/10">
        <div aria-hidden className="af-timer-orbit af-learning-motion absolute inset-3 rounded-full border border-dashed border-[var(--af-route-accent)] opacity-40" />
        <div aria-hidden className="absolute inset-8 rounded-full bg-[var(--af-route-accent-soft)] blur-xl" />
        <div className="relative text-center">
          <p className="font-mono text-4xl text-white">42:18</p>
          <p className="mt-2 text-xs text-zinc-500">有效投入进行中</p>
        </div>
      </div>
      <div className="w-full border-y border-white/10 py-4 md:border-l md:border-y-0 md:py-1 md:pl-6">
        <p className="text-xs text-zinc-500">高等数学 · 极限定义</p>
        <div className="mt-5 flex h-14 items-end gap-1.5" aria-hidden>
          {[30, 48, 42, 76, 58, 86, 64, 92, 72, 84, 66, 88].map((height, index) => (
            <span
              className="af-focus-bar af-learning-motion flex-1 rounded-t-sm bg-[var(--af-route-accent)] opacity-55"
              key={`${height}-${index}`}
              style={{ height: `${height}%`, animationDelay: `${index * 80}ms` }}
            />
          ))}
        </div>
        <div className="mt-5 flex justify-between text-xs text-zinc-600">
          <span>中断 0</span>
          <span>本地计时已同步</span>
        </div>
      </div>
    </div>
  );
}

function CaptureScene() {
  const rows = [
    ["有效时长", "42 分钟", "已确认"],
    ["完成结果", "能复述极限定义", "已记录"],
    ["遗留问题", "ε 的选择仍不稳定", "送往复测"],
  ];
  return (
    <div className="flex min-h-[240px] flex-col justify-center">
      <div className="divide-y divide-white/10 border-y border-white/10">
        {rows.map(([label, value, status], index) => (
          <div className="af-scene-row grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 py-4" key={label} style={{ animationDelay: `${index * 130}ms` }}>
            <span className="text-xs text-zinc-600">{label}</span>
            <span className="text-sm text-zinc-200">{value}</span>
            <span className="text-xs text-[var(--af-route-accent)]">{status}</span>
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-center gap-3 text-xs text-zinc-500">
        <Sparkles aria-hidden size={15} className="text-[var(--af-route-accent)]" />
        时间、结果与问题被绑定为同一份学习证据
      </div>
    </div>
  );
}

function ProofScene() {
  return (
    <div className="grid min-h-[240px] gap-5 md:grid-cols-[1.1fr_0.9fr]">
      <div className="flex flex-col justify-between border-y border-white/10 py-4">
        <div>
          <p className="text-xs text-zinc-600">不看笔记，回答</p>
          <p className="mt-3 text-lg leading-7 text-zinc-100">为什么 δ 的选择必须依赖 ε？</p>
        </div>
        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/5">
          <div className="af-proof-progress af-learning-motion h-full rounded-full bg-[var(--af-route-accent)]" />
        </div>
      </div>
      <div className="flex flex-col justify-center gap-3 border-l border-white/10 pl-5">
        <ProofStatus label="定义结构" value="完整" passed />
        <ProofStatus label="边界解释" value="有遗漏" />
        <ProofStatus label="当前掌握" value="68%" />
      </div>
    </div>
  );
}

function ProofStatus({ label, value, passed = false }: { label: string; value: string; passed?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-white/10 pb-3 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className={passed ? "text-emerald-300" : "text-[var(--af-route-accent)]"}>{value}</span>
    </div>
  );
}

function SummaryScene() {
  return (
    <div className="flex min-h-[240px] flex-col justify-between">
      <div className="grid grid-cols-3 divide-x divide-white/10 border-y border-white/10 py-5 text-center">
        <Metric value="42m" label="有效学习" />
        <Metric value="1" label="完成活动" />
        <Metric value="68%" label="掌握判断" />
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
        <div className="flex items-start gap-3">
          <CircleAlert aria-hidden size={16} className="mt-0.5 text-amber-300" />
          <div>
            <p className="text-sm text-zinc-200">仍有 1 个知识断层待复测</p>
            <p className="mt-1 text-xs text-zinc-600">不会因为结束一天而消失</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-emerald-300">
          <Check aria-hidden size={14} />
          最低学习动作已完成
        </div>
      </div>
      <div className="mt-5 h-1 overflow-hidden bg-white/5">
        <div className="af-summary-progress af-learning-motion h-full bg-[var(--af-route-accent)]" />
      </div>
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="font-mono text-2xl text-white">{value}</p>
      <p className="mt-1 text-xs text-zinc-600">{label}</p>
    </div>
  );
}

function TrendScene() {
  return (
    <div className="grid min-h-[240px] gap-5 md:grid-cols-[1.2fr_0.8fr] md:items-center">
      <div className="border-y border-white/10 py-4">
        <div className="flex justify-between text-xs text-zinc-600">
          <span>7 日掌握趋势</span>
          <span className="text-[var(--af-route-accent)]">+12%</span>
        </div>
        <svg aria-label="掌握趋势逐步上升" className="mt-4 h-32 w-full overflow-visible" role="img" viewBox="0 0 320 120">
          <path d="M0 98 C36 92 48 68 80 74 S126 96 160 60 S208 72 240 38 S284 44 320 18" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
          <path className="af-trend-path af-learning-motion" d="M0 98 C36 92 48 68 80 74 S126 96 160 60 S208 72 240 38 S284 44 320 18" fill="none" stroke="var(--af-route-accent)" strokeLinecap="round" strokeWidth="3" />
        </svg>
      </div>
      <div className="border-l border-white/10 pl-5">
        <p className="text-xs text-zinc-600">系统建议 · 待确认</p>
        <p className="mt-3 text-base leading-7 text-zinc-100">下一周期继续高数基础，并提高定义复测占比。</p>
        <p className="mt-4 text-xs leading-6 text-zinc-500">建议不会自动修改路线，确认后才回到下一次学习安排。</p>
      </div>
    </div>
  );
}

function FlowHandoff({ node }: { node: LearningLoopNode }) {
  return (
    <div className="relative z-10 mt-7 border-t border-white/10 pt-5">
      <div className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        <FlowNode label={node.inputLabel} value={node.inputValue} />
        <div className="flex items-center gap-2 text-xs text-zinc-600">
          <span aria-hidden className="h-px w-8 bg-white/10" />
          {node.actionLabel}
          <span aria-hidden className="h-px w-8 bg-white/10" />
        </div>
        <FlowNode align="right" label={node.outputLabel} value={node.outputValue} />
        <span aria-hidden className="af-flow-token af-learning-motion absolute top-1/2 size-2 -translate-y-1/2 rounded-full bg-[var(--af-route-accent)] shadow-[0_0_14px_var(--af-route-accent)]" />
      </div>
      <div className="mt-4 flex items-center justify-end gap-2 text-xs text-zinc-500">
        <span>{node.nextLabel}</span>
        <ArrowRight aria-hidden size={14} style={{ color: node.accent }} />
      </div>
    </div>
  );
}

function FlowNode({ label, value, align = "left" }: { label: string; value: string; align?: "left" | "right" }) {
  return (
    <div className={`min-w-0 ${align === "right" ? "text-right" : ""}`}>
      <p className="text-[10px] text-zinc-600">{label}</p>
      <p className="mt-1 min-h-10 break-words text-xs font-medium leading-5 text-zinc-300 sm:min-h-0 sm:text-sm">{value}</p>
    </div>
  );
}
