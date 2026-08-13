import type { LucideIcon } from "lucide-react";
import {
  BrainCircuit,
  CheckCircle2,
  Clock3,
  LineChart,
  NotebookPen,
  Target,
} from "lucide-react";

export type LearningLoopId = "plan" | "focus" | "closeout" | "retest" | "today" | "adjust";
export type LearningLoopScene = "select" | "timer" | "capture" | "proof" | "summary" | "trend";

export interface LearningLoopNode {
  id: LearningLoopId;
  scene: LearningLoopScene;
  step: number;
  navTitle: string;
  kicker: string;
  title: string;
  desc: string;
  inputLabel: string;
  inputValue: string;
  actionLabel: string;
  outputLabel: string;
  outputValue: string;
  nextLabel: string;
  accent: string;
  accentSoft: string;
  textClass: string;
  lineClass: string;
  borderClass: string;
  glowClass: string;
  icon: LucideIcon;
}

export const LEARNING_LOOP_NODES: readonly LearningLoopNode[] = [
  {
    id: "plan",
    scene: "select",
    step: 1,
    navTitle: "开始学习",
    kicker: "锁定本次投入",
    title: "先选清楚，再开始",
    desc: "从科目进入学习，任务与考纲只作为可选上下文。本次投入必须先有明确边界。",
    inputLabel: "当前目标",
    inputValue: "高等数学 · 极限定义",
    actionLabel: "选择科目与边界",
    outputLabel: "形成",
    outputValue: "学习意图",
    nextLabel: "带着明确目标进入专注",
    accent: "#60a5fa",
    accentSoft: "rgba(96, 165, 250, 0.16)",
    textClass: "text-blue-300",
    lineClass: "bg-blue-400",
    borderClass: "border-blue-400/60",
    glowClass: "bg-blue-500/10",
    icon: Target,
  },
  {
    id: "focus",
    scene: "timer",
    step: 2,
    navTitle: "专注计时",
    kicker: "让投入变成事实",
    title: "目标不变，持续投入",
    desc: "本地优先计时持续记录真实学习活动；只有同步并收口后，时间才成为可信证据。",
    inputLabel: "承接",
    inputValue: "学习意图",
    actionLabel: "42 分钟持续投入",
    outputLabel: "形成",
    outputValue: "学习活动",
    nextLabel: "把时间送入学习收口",
    accent: "#2dd4bf",
    accentSoft: "rgba(45, 212, 191, 0.16)",
    textClass: "text-teal-300",
    lineClass: "bg-teal-400",
    borderClass: "border-teal-400/60",
    glowClass: "bg-teal-500/10",
    icon: Clock3,
  },
  {
    id: "closeout",
    scene: "capture",
    step: 3,
    navTitle: "学习收口",
    kicker: "把过程变成结果",
    title: "结束计时，不等于结束学习",
    desc: "确认有效时长、完成结果和遗留问题，让一次活动留下可继续使用的结构化记录。",
    inputLabel: "承接",
    inputValue: "学习活动",
    actionLabel: "提交结果与问题",
    outputLabel: "形成",
    outputValue: "学习证据",
    nextLabel: "用证据安排复测",
    accent: "#fbbf24",
    accentSoft: "rgba(251, 191, 36, 0.15)",
    textClass: "text-amber-300",
    lineClass: "bg-amber-300",
    borderClass: "border-amber-300/60",
    glowClass: "bg-amber-400/10",
    icon: NotebookPen,
  },
  {
    id: "retest",
    scene: "proof",
    step: 4,
    navTitle: "证据复测",
    kicker: "验证是否真正掌握",
    title: "不看笔记，再证明一次",
    desc: "复测承接刚刚暴露的知识断层，以回忆和作答结果校准掌握度，而不是相信学习时长。",
    inputLabel: "承接",
    inputValue: "学习证据",
    actionLabel: "回忆与复测",
    outputLabel: "形成",
    outputValue: "掌握判断",
    nextLabel: "把掌握结果并入今日闭环",
    accent: "#38bdf8",
    accentSoft: "rgba(56, 189, 248, 0.16)",
    textClass: "text-sky-300",
    lineClass: "bg-sky-400",
    borderClass: "border-sky-400/60",
    glowClass: "bg-sky-500/10",
    icon: BrainCircuit,
  },
  {
    id: "today",
    scene: "summary",
    step: 5,
    navTitle: "今日闭环",
    kicker: "对账今天的真实结果",
    title: "完成、欠账、下一步都要有去处",
    desc: "今日汇总学习与复测结果，保留未决事项，并确认最低学习动作是否真正完成。",
    inputLabel: "承接",
    inputValue: "掌握判断",
    actionLabel: "完成今日对账",
    outputLabel: "形成",
    outputValue: "日证据快照",
    nextLabel: "让连续日证据进入周期判断",
    accent: "#34d399",
    accentSoft: "rgba(52, 211, 153, 0.16)",
    textClass: "text-emerald-300",
    lineClass: "bg-emerald-400",
    borderClass: "border-emerald-400/60",
    glowClass: "bg-emerald-500/10",
    icon: CheckCircle2,
  },
  {
    id: "adjust",
    scene: "trend",
    step: 6,
    navTitle: "阶段调整",
    kicker: "用周期证据修正路线",
    title: "趋势提出建议，决定仍由你确认",
    desc: "周期报告汇总投入、欠账和掌握变化，形成待确认的下一阶段建议，再回流到下一次学习。",
    inputLabel: "承接",
    inputValue: "日证据快照",
    actionLabel: "识别周期偏差",
    outputLabel: "形成",
    outputValue: "待确认调整",
    nextLabel: "确认后回到下一次开始学习",
    accent: "#c084fc",
    accentSoft: "rgba(192, 132, 252, 0.15)",
    textClass: "text-purple-300",
    lineClass: "bg-purple-400",
    borderClass: "border-purple-400/60",
    glowClass: "bg-purple-500/10",
    icon: LineChart,
  },
] as const;

export const LEARNING_LOOP_DURATION_MS = 6_800;
