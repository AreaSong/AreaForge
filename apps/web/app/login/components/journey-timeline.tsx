import type { CSSProperties } from "react";
import { Pause, Play } from "lucide-react";
import { LEARNING_LOOP_NODES } from "../constants/learning-loop";

interface JourneyTimelineProps {
  activeNodeIndex: number;
  autoPlay: boolean;
  paused: boolean;
  reducedMotion: boolean;
  onNodeSelect: (index: number) => void;
  onAutoPlayChange: (playing: boolean) => void;
}

export function JourneyTimeline({
  activeNodeIndex,
  autoPlay,
  paused,
  reducedMotion,
  onNodeSelect,
  onAutoPlayChange,
}: JourneyTimelineProps) {
  const progress = (activeNodeIndex / (LEARNING_LOOP_NODES.length - 1)) * 100;
  const current = LEARNING_LOOP_NODES[activeNodeIndex];

  return (
    <nav aria-label="学习闭环路线" className="relative mt-6 border-t border-white/10 pt-5 lg:mt-8">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-medium text-zinc-600">LEARNING LOOP</p>
          <p className="mt-1 truncate text-xs text-zinc-400">
            {String(current.step).padStart(2, "0")} · {current.navTitle} · {current.outputValue}
          </p>
        </div>

        {!reducedMotion ? (
          <button
            aria-label={autoPlay ? "暂停路线演示" : "继续路线演示"}
            className="grid size-9 shrink-0 place-items-center rounded-md border border-white/10 text-zinc-400 transition-colors hover:border-white/20 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05080a]"
            onClick={() => onAutoPlayChange(!autoPlay)}
            title={autoPlay ? "暂停路线演示" : "继续路线演示"}
            type="button"
          >
            {autoPlay ? <Pause aria-hidden size={15} /> : <Play aria-hidden size={15} />}
          </button>
        ) : null}
      </div>

      <div className="relative">
        <div aria-hidden className="absolute left-[8.333333%] right-[8.333333%] top-5 h-px bg-white/10">
          <div
            className="af-route-progress h-full origin-left bg-gradient-to-r from-blue-400 via-teal-400 via-50% to-purple-400 shadow-[0_0_12px_rgba(45,212,191,0.45)]"
            style={{ width: `${progress}%` }}
          />
          {!paused ? <span className="af-route-runner af-learning-motion absolute top-1/2 size-2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_14px_var(--af-route-active-accent)]" style={{ left: `${progress}%`, "--af-route-active-accent": current.accent } as CSSProperties} /> : null}
        </div>

        <ol className="relative grid grid-cols-6 gap-1">
          {LEARNING_LOOP_NODES.map((node, index) => {
            const Icon = node.icon;
            const isActive = index === activeNodeIndex;
            const isComplete = index < activeNodeIndex;
            return (
              <li className="min-w-0" key={node.id}>
                <button
                  aria-current={isActive ? "step" : undefined}
                  aria-label={`第 ${node.step} 步：${node.navTitle}`}
                  className="group flex w-full min-w-0 flex-col items-center gap-2 rounded-md px-1 py-1 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05080a]"
                  onClick={() => onNodeSelect(index)}
                  type="button"
                >
                  <span
                    className={`relative grid size-10 place-items-center rounded-full border bg-[#080b0f] transition-[border-color,color,transform,box-shadow] duration-300 ${isActive ? `${node.borderClass} ${node.textClass} scale-105 shadow-[0_0_18px_var(--af-route-node-accent)]` : isComplete ? "border-white/25 text-zinc-300" : "border-white/10 text-zinc-700 group-hover:border-white/25 group-hover:text-zinc-400"}`}
                    style={{ "--af-route-node-accent": node.accent } as CSSProperties}
                  >
                    <Icon aria-hidden size={15} strokeWidth={isActive ? 2.4 : 1.8} />
                    {isActive && !paused ? <span aria-hidden className="af-node-pulse af-learning-motion absolute inset-0 rounded-full border border-[var(--af-route-node-accent)]" /> : null}
                  </span>
                  <span className={`truncate text-[10px] sm:text-xs ${isActive ? node.textClass : isComplete ? "text-zinc-400" : "text-zinc-600"}`}>
                    {node.navTitle}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2 text-[10px] text-zinc-600">
        <span>阶段调整</span>
        <span aria-hidden>→</span>
        <span>下一轮开始学习</span>
      </div>
    </nav>
  );
}
