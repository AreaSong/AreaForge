import { Button } from "@/components/ui/button";
import { useRef, type KeyboardEvent } from "react";
import {
  CalendarCheck2,
  ChartNoAxesCombined,
  Clock3,
  FileCheck2,
  NotebookPen,
  Target,
  type LucideIcon,
} from "lucide-react";

export type JourneyStepId =
  | "start"
  | "focus"
  | "closeout"
  | "evidence"
  | "today"
  | "adjust";

interface JourneyStep {
  id: JourneyStepId;
  label: string;
  detail: string;
  icon: LucideIcon;
}

export const JOURNEY_STEPS: readonly JourneyStep[] = [
  { id: "start", label: "开始学习", detail: "选科目", icon: Target },
  { id: "focus", label: "专注计时", detail: "持续投入", icon: Clock3 },
  { id: "closeout", label: "学习收口", detail: "记录结果", icon: NotebookPen },
  { id: "evidence", label: "证据 / 复测", detail: "验证掌握", icon: FileCheck2 },
  { id: "today", label: "今日闭环", detail: "完成行动", icon: CalendarCheck2 },
  { id: "adjust", label: "周期调整", detail: "修正路线", icon: ChartNoAxesCombined },
];

interface JourneyTimelineProps {
  activeStep: JourneyStepId;
  onStepChange: (step: JourneyStepId) => void;
}

export function JourneyTimeline({ activeStep, onStepChange }: JourneyTimelineProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const moveToStep = (index: number) => {
    const nextIndex = (index + JOURNEY_STEPS.length) % JOURNEY_STEPS.length;
    const nextStep = JOURNEY_STEPS[nextIndex];

    onStepChange(nextStep.id);
    tabRefs.current[nextIndex]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveToStep(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveToStep(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveToStep(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveToStep(JOURNEY_STEPS.length - 1);
    }
  };

  return (
    <nav aria-label="AreaForge 学习闭环" className="mt-6">
      <p className="sr-only" id="learning-loop-tab-help">
        选择步骤查看对应的产品内容。使用左右方向键切换步骤。
      </p>
      <ol
        aria-describedby="learning-loop-tab-help"
        aria-label="学习闭环步骤"
        aria-orientation="horizontal"
        className="grid grid-cols-3 gap-2 sm:grid-cols-6"
        role="tablist"
      >
        {JOURNEY_STEPS.map((step, index) => {
          const Icon = step.icon;
          const isActive = step.id === activeStep;

          return (
            <li key={step.id} role="presentation">
              <Button
                aria-controls="learning-loop-panel"
                aria-selected={isActive}
                className={`group grid min-h-[4.25rem] w-full place-items-center rounded-xl border px-2 py-2.5 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-teal-200 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1515] sm:min-h-[4.75rem] sm:px-1 ${
                  isActive
                    ? "border-teal-300/40 bg-teal-300/[0.1] text-white"
                    : "border-white/[0.07] bg-white/[0.025] text-zinc-400 hover:border-white/[0.14] hover:bg-white/[0.045] hover:text-zinc-200"
                }`}
                id={`learning-loop-tab-${step.id}`}
                onClick={() => onStepChange(step.id)}
                onKeyDown={(event) => handleKeyDown(event, index)}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                role="tab"
                tabIndex={isActive ? 0 : -1}
                type="button"
              >
                <span>
                  <Icon
                    aria-hidden
                    className={`mx-auto size-4 ${isActive ? "text-teal-200" : "text-zinc-500 group-hover:text-zinc-300"}`}
                  />
                  <span className="mt-1.5 block text-[11px] font-medium sm:text-xs">{step.label}</span>
                  <span className={`mt-0.5 hidden text-[10px] sm:block ${isActive ? "text-teal-100/65" : "text-zinc-600"}`}>
                    {step.detail}
                  </span>
                </span>
              </Button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
