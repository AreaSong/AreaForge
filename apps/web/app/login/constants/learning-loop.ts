import { Target, Clock, BrainCircuit, CheckCircle2, LineChart, Hexagon } from "lucide-react";

export const LEARNING_LOOP_NODES = [
  {
    id: "overview",
    navTitle: "系统核心",
    title1: "硬核驱动，",
    title2: "无情督战引擎",
    desc: "AreaForge 是专为极客打造的长期备考工作流。我们不提供安慰剂式的待办清单，只提供基于数据、证据与强制闭环的绝对进化体系。",
    colorClass: "from-teal-400 via-cyan-400 to-blue-500",
    glowClass: "bg-teal-500/20",
    lineClass: "bg-teal-400",
    borderClass: "border-teal-500",
    textClass: "text-teal-400",
    icon: Hexagon
  },
  {
    id: "plan",
    navTitle: "开始学习",
    title1: "明确目标，",
    title2: "拒绝漫无目的",
    desc: "在进入战场前，清晰界定本次学习的科目与任务边界，让每一次投入都有的放矢。",
    colorClass: "from-blue-400 to-indigo-400",
    glowClass: "bg-blue-500/10",
    lineClass: "bg-blue-400",
    borderClass: "border-blue-400",
    textClass: "text-blue-400",
    icon: Target
  },
  {
    id: "focus",
    navTitle: "专注计时",
    title1: "绝对心流，",
    title2: "深度自我锻造",
    desc: "本地优先的硬核计时引擎，隔绝一切干扰。我们只记录你真实沉浸的每一秒。",
    colorClass: "from-teal-400 to-cyan-300",
    glowClass: "bg-teal-500/10",
    lineClass: "bg-cyan-400",
    borderClass: "border-cyan-400",
    textClass: "text-cyan-400",
    icon: Clock
  },
  {
    id: "retest",
    navTitle: "证据复测",
    title1: "直面弱点，",
    title2: "打破知识幻觉",
    desc: "时间结束并不代表掌握。系统强制提取客观证据与刻意复测，精准定位知识断层。",
    colorClass: "from-cyan-400 to-blue-400",
    glowClass: "bg-cyan-500/10",
    lineClass: "bg-blue-400",
    borderClass: "border-blue-400",
    textClass: "text-blue-400",
    icon: BrainCircuit
  },
  {
    id: "closeout",
    navTitle: "今日闭环",
    title1: "收口清算，",
    title2: "绝不把债务交给明天",
    desc: "将一天的零散碎片与复盘进行终极对账。彻底完成闭环，才能真正放下负担去休息。",
    colorClass: "from-emerald-400 to-teal-400",
    glowClass: "bg-emerald-500/10",
    lineClass: "bg-emerald-400",
    borderClass: "border-emerald-400",
    textClass: "text-emerald-400",
    icon: CheckCircle2
  },
  {
    id: "adjust",
    navTitle: "阶段调整",
    title1: "周期复盘，",
    title2: "重塑进化路线",
    desc: "基于客观的长期微观数据为你生成周期报告，指导下一阶段的战略调整，持续破局。",
    colorClass: "from-violet-400 to-fuchsia-400",
    glowClass: "bg-violet-500/10",
    lineClass: "bg-fuchsia-400",
    borderClass: "border-fuchsia-400",
    textClass: "text-fuchsia-400",
    icon: LineChart
  }
];

export type LearningLoopNode = typeof LEARNING_LOOP_NODES[0];
