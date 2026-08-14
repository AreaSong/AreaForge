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
export type TrackMode = "mastery" | "remedial";

export interface SubjectTelemetry {
  id: string;
  name: string;
  enName: string;
  code: string;
  topic: string;
  tier: string;
  targetDuration: string;
  confidence: string;
  formula: string;
  active: boolean;
}

export interface MetricItem {
  label: string;
  value: string;
  unit?: string;
  change?: string;
}

export interface TrackTelemetry {
  trackName: string;
  badge: string;
  leadTitle: string;
  subLead: string;
  focusMode: string;
  metrics: MetricItem[];
  primaryArtifact: string;
  artifactStatus: string;
  retentionScore: { before: number; after: number; grade: string };
  reconciliationStatus: string;
  advice: string;
  nextStep: string;
  subjects?: SubjectTelemetry[];
  telemetry?: Record<string, unknown>;
}

export interface LearningLoopNode {
  id: LearningLoopId;
  scene: LearningLoopScene;
  step: number;
  navTitle: string;
  enNavTitle: string;
  kicker: string;
  title: string;
  subtitle: string;
  desc: string;
  statusPill: string;
  statusPillType: "locked" | "active" | "sealed" | "verified" | "reconciled" | "corridor";
  inputLabel: string;
  inputValue: string;
  actionLabel: string;
  outputLabel: string;
  outputValue: string;
  nextLabel: string;
  accent: string;
  accentRgb: string;
  accentSoft: string;
  textClass: string;
  lineClass: string;
  borderClass: string;
  glowClass: string;
  icon: LucideIcon;
  metrics: MetricItem[];
  masteryTrack: TrackTelemetry;
  remedialTrack: TrackTelemetry;
  telemetry: Record<string, unknown>;
}

export const LEARNING_LOOP_NODES: readonly LearningLoopNode[] = [
  {
    id: "plan",
    scene: "select",
    step: 1,
    navTitle: "开始学习",
    enNavTitle: "TARGET INTENT",
    kicker: "STEP 01 / 06 · 锁定目标",
    title: "先选清楚，再开始",
    subtitle: "锁定研读科目与考点范围",
    desc: "从科目进入学习，任务与考纲作为可选上下文。本次研读必须先有清晰的认知边界与攻坚目标。",
    statusPill: "高等数学 · 极限论与连续性",
    statusPillType: "locked",
    inputLabel: "当前目标",
    inputValue: "高等数学 · 极限定义",
    actionLabel: "选择科目与边界",
    outputLabel: "形成",
    outputValue: "学习意图",
    nextLabel: "带着明确目标进入专注",
    accent: "#60a5fa",
    accentRgb: "96, 165, 250",
    accentSoft: "rgba(96, 165, 250, 0.16)",
    textClass: "text-blue-300",
    lineClass: "bg-blue-400",
    borderClass: "border-blue-400/60",
    glowClass: "bg-blue-500/15",
    icon: Target,
    metrics: [
      { label: "目标考点", value: "ε-δ 极限论", unit: "L1" },
      { label: "预估时长", value: "45", unit: "min" },
      { label: "意图状态", value: "已锁定", unit: "100%" },
    ],
    masteryTrack: {
      trackName: "掌握良好 · 进阶路线",
      badge: "高阶攻坚",
      leadTitle: "高阶攻坚 · 知识图谱横向扩展与综合证明",
      subLead: "综合证明与真题攻坚 (60-90 min 深度研读)",
      focusMode: "深度研读模式",
      metrics: [
        { label: "攻坚科目", value: "高等数学", unit: "MATH-01" },
        { label: "目标考点", value: "多元微分与级数综合", unit: "高阶" },
        { label: "目标强度", value: "综合大题", unit: "95%" },
      ],
      primaryArtifact: "高阶证明题集 · 母题模型",
      artifactStatus: "TARGET_LOCKED",
      retentionScore: { before: 85, after: 96, grade: "GRADE S" },
      reconciliationStatus: "攻坚目标已就绪",
      advice: "基础概念稳固，直接攻关压轴大题，提炼一题多解范式。",
      nextStep: "带着高阶目标进入深度专注",
      subjects: [
        {
          id: "math",
          name: "高等数学",
          enName: "ADVANCED MATH",
          code: "MATH-01",
          topic: "多元微分学极值判定与级数收敛综合证明",
          tier: "高阶攻坚 · 压轴综合",
          targetDuration: "60 MIN",
          confidence: "92%",
          formula: "f(x,y) = f(x₀,y₀) + df + \\frac{1}{2!}d^2f + R_n, \\quad \\mathbf{H} \\succ 0 \\Rightarrow \\text{极小值}",
          active: true,
        },
        {
          id: "cs408",
          name: "408 计算机学科",
          enName: "CS 408 COMPREHENSIVE",
          code: "CS-408",
          topic: "红黑树 5 大不变式性质与插入旋转重平衡",
          tier: "数据结构 · 算法核心",
          targetDuration: "60 MIN",
          confidence: "88%",
          formula: "RB-Insert-Fixup(T, z): Case 1/2/3 变色与左/右旋平衡",
          active: false,
        },
        {
          id: "english",
          name: "考研英语",
          enName: "ENGLISH ACADEMIC",
          code: "ENG-01",
          topic: "外刊学术社论超长难句多层嵌套主干抽离",
          tier: "英语精读 · 深度剖析",
          targetDuration: "45 MIN",
          confidence: "90%",
          formula: "Clause(Matrix) ⊕ Relative[that/which] ⇒ Core Proposition",
          active: false,
        },
      ],
    },
    remedialTrack: {
      trackName: "暴露断层 · 补救路线",
      badge: "概念诊断",
      leadTitle: "概念解构 · 基础定义精读与根因归因",
      subLead: "单点概念突破与例题精研 (25-35 min 微目标)",
      focusMode: "靶向攻坚模式",
      metrics: [
        { label: "攻坚科目", value: "高等数学", unit: "MATH-01" },
        { label: "断层考点", value: "ε-δ 极限定义去心邻域", unit: "基础" },
        { label: "补救目标", value: "根因厘清", unit: "80%" },
      ],
      primaryArtifact: "概念断层切片 · 基础骨架",
      artifactStatus: "GAP_PINPOINTED",
      retentionScore: { before: 45, after: 82, grade: "GRADE B+" },
      reconciliationStatus: "断层卡点已锁定",
      advice: "厘清去心邻域 δ 与 ε 的上界约束逻辑，消除二次项交叉干扰。",
      nextStep: "针对断层卡点进入靶向专注",
      subjects: [
        {
          id: "math",
          name: "高等数学",
          enName: "ADVANCED MATH",
          code: "MATH-01",
          topic: "ε-δ 极限定义去心邻域边界取值与不等式放大",
          tier: "概念突破 · 基础骨架",
          targetDuration: "35 MIN",
          confidence: "68%",
          formula: "∀ε > 0, ∃δ = min{1, ε / (2|x₀| + 1)}, s.t. 0 < |x-x₀| < δ ⇒ |f(x)-L| < ε",
          active: true,
        },
        {
          id: "cs408",
          name: "408 计算机学科",
          enName: "CS 408 COMPREHENSIVE",
          code: "CS-408",
          topic: "二叉树非递归遍历栈模拟与线索化前驱判定",
          tier: "数据结构 · 断层攻坚",
          targetDuration: "40 MIN",
          confidence: "65%",
          formula: "Thread(P) = {left: ltag==1 ? pred : lchild, right: rtag==1 ? succ : rchild}",
          active: false,
        },
        {
          id: "english",
          name: "考研英语",
          enName: "ENGLISH ACADEMIC",
          code: "ENG-01",
          topic: "定语从句与同位语从句引导词混淆纠偏与成分切分",
          tier: "语法断层 · 结构精修",
          targetDuration: "30 MIN",
          confidence: "70%",
          formula: "Noun + [that ... 完整] ⇒ 同位语; [that ... 缺成分] ⇒ 定语",
          active: false,
        },
      ],
    },
    telemetry: {
      subjects: [
        {
          id: "math",
          name: "高等数学",
          enName: "ADVANCED MATH",
          code: "MATH-01",
          topic: "ε-δ 极限定义与收敛性证明",
          tier: "核心考点 · 基础骨架",
          targetDuration: "45 MIN",
          confidence: "88%",
          formula: "∀ε > 0, ∃δ > 0, s.t. 0 < |x-x₀| < δ ⇒ |f(x)-L| < ε",
          active: true,
        },
        {
          id: "cs408",
          name: "408 计算机学科",
          enName: "CS 408 COMPREHENSIVE",
          code: "CS-408",
          topic: "二叉树非递归遍历与线索化",
          tier: "数据结构 · 核心算法",
          targetDuration: "60 MIN",
          confidence: "74%",
          formula: "Thread(P) = {left: ltag==1 ? pred : lchild, right: rtag==1 ? succ : rchild}",
          active: false,
        },
        {
          id: "english",
          name: "考研英语",
          enName: "ENGLISH ACADEMIC",
          code: "ENG-01",
          topic: "长难句主干抽离与同义替换",
          tier: "英语精读 · 深度剖析",
          targetDuration: "30 MIN",
          confidence: "82%",
          formula: "Clause(Sub + Pred) ⊕ Relative[that/which] ⇒ Core Meaning",
          active: false,
        },
      ] as SubjectTelemetry[],
    },
  },
  {
    id: "focus",
    scene: "timer",
    step: 2,
    navTitle: "专注计时",
    enNavTitle: "DEEP FOCUS FORGE",
    kicker: "STEP 02 / 06 · 专注投入",
    title: "目标不变，持续投入",
    subtitle: "本地优先计时与专注节奏反馈",
    desc: "本地优先计时持续记录真实学习投入；只有同步并收口后，时间才沉淀为可信证据。",
    statusPill: "专注研读中 · 42:18",
    statusPillType: "active",
    inputLabel: "承接",
    inputValue: "学习意图",
    actionLabel: "42 分钟持续投入",
    outputLabel: "形成",
    outputValue: "学习活动",
    nextLabel: "把时间送入学习收口",
    accent: "#2dd4bf",
    accentRgb: "45, 212, 191",
    accentSoft: "rgba(45, 212, 191, 0.16)",
    textClass: "text-teal-300",
    lineClass: "bg-teal-400",
    borderClass: "border-teal-400/60",
    glowClass: "bg-teal-500/15",
    icon: Clock3,
    metrics: [
      { label: "有效专注", value: "42:18", unit: "min" },
      { label: "专注稳定性", value: "98.6%", unit: "极佳" },
      { label: "中断次数", value: "0", unit: "次" },
    ],
    masteryTrack: {
      trackName: "掌握良好 · 进阶路线",
      badge: "深度心流",
      leadTitle: "深度心流 · 长时段无中断连续沉浸",
      subLead: "60 分钟心流冲刺 · 高强度综合题推导",
      focusMode: "心流冲刺 (FLOW SPRINT)",
      metrics: [
        { label: "有效专注", value: "42:18", unit: "min" },
        { label: "专注稳定性", value: "98.6%", unit: "极佳" },
        { label: "中断次数", value: "0", unit: "次" },
      ],
      primaryArtifact: "连续心流会话记录",
      artifactStatus: "SYNCED_ACTIVE",
      retentionScore: { before: 88, after: 96, grade: "GRADE S" },
      reconciliationStatus: "单任务会话受控保护中",
      advice: "连续沉浸 42 分钟，当前解题节奏极佳，建议一气呵成完成压轴证明推导。",
      nextStep: "把完整心流时间送入学习收口",
    },
    remedialTrack: {
      trackName: "暴露断层 · 补救路线",
      badge: "番茄分段",
      leadTitle: "番茄分段 · 节奏护航与认知防疲劳",
      subLead: "25 分钟番茄分段 · 针对断层卡点逐步拆解",
      focusMode: "分段节奏 (PACED POMODORO)",
      metrics: [
        { label: "本段专注", value: "18:45", unit: "min" },
        { label: "卡点标记", value: "1", unit: "处已标" },
        { label: "认知负荷", value: "适中", unit: "NORMAL" },
      ],
      primaryArtifact: "卡点切片计时记录",
      artifactStatus: "CHECKPOINT_READY",
      retentionScore: { before: 50, after: 80, grade: "GRADE B+" },
      reconciliationStatus: "分段检查点正常运行",
      advice: "遇到推导卡点可点击「标记断层」，无需中断计时，收口时统一归档排期。",
      nextStep: "把断层攻坚记录送入学习收口",
    },
    telemetry: {
      timerString: "42:18",
      subSeconds: "84",
      progressRatio: 0.705,
      frequencyOctaves: 28,
      entropyIndex: "0.02 (STABLE)",
      sessionMode: "LOCAL_FIRST_SYNCED",
    },
  },
  {
    id: "closeout",
    scene: "capture",
    step: 3,
    navTitle: "学习收口",
    enNavTitle: "EVIDENCE SYNTHESIS",
    kicker: "STEP 03 / 06 · 证据归档",
    title: "结束计时，不等于结束学习",
    subtitle: "时长、产出与断层三路结构化归档",
    desc: "确认有效时长、完成结果和遗留问题，让一次活动留下可继续使用的结构化凭据。",
    statusPill: "凭据归档 · AF-EVID-8921",
    statusPillType: "sealed",
    inputLabel: "承接",
    inputValue: "学习活动",
    actionLabel: "提交结果与问题",
    outputLabel: "形成",
    outputValue: "学习证据",
    nextLabel: "用证据安排复测",
    accent: "#fbbf24",
    accentRgb: "251, 191, 36",
    accentSoft: "rgba(251, 191, 36, 0.15)",
    textClass: "text-amber-300",
    lineClass: "bg-amber-300",
    borderClass: "border-amber-300/60",
    glowClass: "bg-amber-400/15",
    icon: NotebookPen,
    metrics: [
      { label: "融合流数", value: "3", unit: "路" },
      { label: "证据凭据", value: "AF-8921", unit: "SEALED" },
      { label: "哈希签名", value: "SHA-256", unit: "OK" },
    ],
    masteryTrack: {
      trackName: "掌握良好 · 进阶路线",
      badge: "成果熔铸",
      leadTitle: "成果熔铸 · 提炼解题模型并沉淀高阶证据",
      subLead: "归档 3 道压轴题解法，生成免复测高阶凭据",
      focusMode: "母题模型归集",
      metrics: [
        { label: "净专注时长", value: "60", unit: "min (96%)" },
        { label: "核心产出", value: "3", unit: "道大题证明" },
        { label: "图谱升级", value: "Grade S", unit: "已达成" },
      ],
      primaryArtifact: "AF-EVID-ADV-8921",
      artifactStatus: "ADVANCED_SEALED",
      retentionScore: { before: 86, after: 96, grade: "GRADE S" },
      reconciliationStatus: "已归入高阶母题库",
      advice: "解题逻辑严谨，母题模型已提取，建议进入盲测冲顶验证巩固掌握。",
      nextStep: "用高阶凭据进入盲测验证",
      telemetry: {
        serialNumber: "AF-EVID-ADV-8921",
        hashDigest: "SHA-256: 8f9b4c2e...7d12a9c3",
        streams: [
          { name: "净投入时长", value: "60 min 满额投入", color: "#2dd4bf", rgb: "45, 212, 191", status: "VERIFIED" },
          { name: "核心产出", value: "3 道压轴大题证明", color: "#34d399", rgb: "52, 211, 153", status: "COMMITTED" },
          { name: "图谱升级", value: "级数审敛升至 Grade S", color: "#60a5fa", rgb: "96, 165, 250", status: "SEALED" },
        ],
      },
    },
    remedialTrack: {
      trackName: "暴露断层 · 补救路线",
      badge: "断层归集",
      leadTitle: "断层归集 · 提取卡点定向排期复测",
      subLead: "标记 2 处概念盲区，生成专项复测诊断任务",
      focusMode: "断层切片归集",
      metrics: [
        { label: "有效时长", value: "35", unit: "min (91%)" },
        { label: "暴露断层", value: "2", unit: "处边界卡点" },
        { label: "排期状态", value: "就绪", unit: "已建池" },
      ],
      primaryArtifact: "AF-EVID-GAP-4102",
      artifactStatus: "GAP_REGISTERED",
      retentionScore: { before: 48, after: 82, grade: "GRADE B+" },
      reconciliationStatus: "定向排入专项复测池",
      advice: "去心邻域边界不等式放大卡点已提取，立即生成阶梯复测诊断卡。",
      nextStep: "用断层凭据安排专项复测",
      telemetry: {
        serialNumber: "AF-EVID-GAP-4102",
        hashDigest: "SHA-256: 3a7c1f8d...9e42b651",
        streams: [
          { name: "净投入时长", value: "35 min 净投入", color: "#2dd4bf", rgb: "45, 212, 191", status: "VERIFIED" },
          { name: "暴露断层", value: "2 处反常积分审敛卡点", color: "#fbbf24", rgb: "251, 191, 36", status: "ROUTED" },
          { name: "归因标记", value: "忽略端点奇点性质", color: "#f87171", rgb: "248, 113, 113", status: "QUEUED" },
        ],
      },
    },
    telemetry: {
      serialNumber: "AF-EVID-20260814-042",
      hashDigest: "SHA-256: 8f9b4c2e...7d12a9c3",
      streams: [
        { name: "有效时长", value: "42 min 净投入", color: "#2dd4bf", rgb: "45, 212, 191", status: "VERIFIED" },
        { name: "解题成果", value: "3 道极限定理证明", color: "#34d399", rgb: "52, 211, 153", status: "COMMITTED" },
        { name: "遗留断层", value: "ε-δ 边界选取不稳定", color: "#fbbf24", rgb: "251, 191, 36", status: "ROUTED" },
      ],
    },
  },
  {
    id: "retest",
    scene: "proof",
    step: 4,
    navTitle: "证据复测",
    enNavTitle: "PROOF VERIFICATION",
    kicker: "STEP 04 / 06 · 掌握校准",
    title: "不看笔记，再证明一次",
    subtitle: "艾宾浩斯主动回忆与真实掌握度校准",
    desc: "复测承接刚刚暴露的知识断层或进阶考点，以主动回忆作答校准真实掌握度，而非依赖时长假象。",
    statusPill: "主动回忆 · 68% → 92%",
    statusPillType: "verified",
    inputLabel: "承接",
    inputValue: "学习证据",
    actionLabel: "回忆与复测",
    outputLabel: "形成",
    outputValue: "掌握判断",
    nextLabel: "把掌握结果并入今日闭环",
    accent: "#38bdf8",
    accentRgb: "56, 189, 248",
    accentSoft: "rgba(56, 189, 248, 0.16)",
    textClass: "text-sky-300",
    lineClass: "bg-sky-400",
    borderClass: "border-sky-400/60",
    glowClass: "bg-sky-500/15",
    icon: BrainCircuit,
    metrics: [
      { label: "基线掌握", value: "68%", unit: "START" },
      { label: "复测掌握", value: "92%", unit: "+24%" },
      { label: "置信级别", value: "HIGH", unit: "GRADE A" },
    ],
    masteryTrack: {
      trackName: "掌握良好 · 进阶路线",
      badge: "盲测冲顶",
      leadTitle: "盲测冲顶 · 极限变式与综合证明推导",
      subLead: "3D 闪卡主动提取 · 验证高阶概念迁移能力",
      focusMode: "综合变式回忆",
      metrics: [
        { label: "基线掌握", value: "85%", unit: "START" },
        { label: "复测跃升", value: "96%", unit: "+11%" },
        { label: "置信评级", value: "GRADE S", unit: "永久掌握" },
      ],
      primaryArtifact: "高阶变式推导卡片",
      artifactStatus: "RETRIEVAL_VERIFIED",
      retentionScore: { before: 85, after: 96, grade: "GRADE S" },
      reconciliationStatus: "7 天长效固化节点已激活",
      advice: "综合变式推导完全正确，知识点迁移稳固，免除近期基础复测。",
      nextStep: "把掌握突破并入今日闭环",
      telemetry: {
        retrievalCard: {
          frontTitle: "主动回忆检测 · 综合变式",
          frontQuestion: "在多元函数极值判定中，若 Hessian 矩阵行列式为 0，如何构造高阶微元反例证明鞍点？",
          backTitle: "核心证明解析 · PROOF RIGOR",
          backProof: "沿 y = kx² 抛物线方向展开 Taylor 多项式，代入检验符号变动，证得原点去心邻域内无极值。",
        },
        initialMastery: 85,
        targetMastery: 96,
      },
    },
    remedialTrack: {
      trackName: "暴露断层 · 补救路线",
      badge: "阶梯诊断",
      leadTitle: "阶梯诊断 · 概念复现与根因纠偏",
      subLead: "3D 闪卡主动提取 · 针对 ε-δ 边界条件逐层推演",
      focusMode: "概念盲测诊断",
      metrics: [
        { label: "基线掌握", value: "58%", unit: "START" },
        { label: "复测跃升", value: "88%", unit: "+30%" },
        { label: "纠偏评级", value: "GRADE A", unit: "断层闭合" },
      ],
      primaryArtifact: "概念纠偏诊断卡片",
      artifactStatus: "GAP_REMEDIATED",
      retentionScore: { before: 58, after: 88, grade: "GRADE A" },
      reconciliationStatus: "24 小时衰减拐点首轮拦截",
      advice: "边界条件放大不等式已自主推导成功，断层成功闭合，按计划并入今日核销。",
      nextStep: "把补救成果并入今日闭环",
      telemetry: {
        retrievalCard: {
          frontTitle: "主动回忆检测 · 概念诊断",
          frontQuestion: "为什么在 ε-δ 极限定义证明中，δ 的取值不仅取决于 ε，还必须受限于去心邻域边界？",
          backTitle: "核心证明解析 · PROOF RIGOR",
          backProof: "必须限制 |x - x₀| < 1 使待消公因式 |x + x₀| < 2|x₀| + 1 有确定上界，故取 δ = min{1, ε / (2|x₀| + 1)}。",
        },
        initialMastery: 58,
        targetMastery: 88,
      },
    },
    telemetry: {
      retrievalCard: {
        frontTitle: "主动回忆检测 · ACTIVE RECALL",
        frontQuestion: "为什么在极限定义中，δ 的取值不仅取决于 ε，还必须受限于去心邻域边界？",
        backTitle: "核心证明解析 · PROOF DECOMPOSITION",
        backProof: "δ 必须保证函数在邻域内有界，故取 δ = min{1, ε / (2|x₀| + 1)}，以此消除二次项干扰。",
      },
      ebbinghausNodes: [
        { label: "即时记忆", rate: "100%", offset: "0m" },
        { label: "衰减拐点", rate: "58%", offset: "20m" },
        { label: "复测激活", rate: "92%", offset: "1d" },
      ],
      initialMastery: 68,
      targetMastery: 92,
    },
  },
  {
    id: "today",
    scene: "summary",
    step: 5,
    navTitle: "今日闭环",
    enNavTitle: "DAILY RECONCILIATION ORBIT",
    kicker: "STEP 05 / 06 · 日终核算",
    title: "完成、欠账、下一步都要有去处",
    subtitle: "时长、断层、任务三环同心对账",
    desc: "今日汇总学习与复测结果，诚实保留未决事项，确认最低研学动作是否真实闭环。",
    statusPill: "三环对账 · 100% 达成",
    statusPillType: "reconciled",
    inputLabel: "承接",
    inputValue: "掌握判断",
    actionLabel: "完成今日对账",
    outputLabel: "形成",
    outputValue: "日证据快照",
    nextLabel: "让连续日证据进入周期判断",
    accent: "#34d399",
    accentRgb: "52, 211, 153",
    accentSoft: "rgba(52, 211, 153, 0.16)",
    textClass: "text-emerald-300",
    lineClass: "bg-emerald-400",
    borderClass: "border-emerald-400/60",
    glowClass: "bg-emerald-500/15",
    icon: CheckCircle2,
    metrics: [
      { label: "净学习时长", value: "4.2", unit: "h / 5.0h" },
      { label: "断层闭合率", value: "75%", unit: "3/4 Gaps" },
      { label: "核心任务", value: "5/5", unit: "100%" },
    ],
    masteryTrack: {
      trackName: "掌握良好 · 进阶路线",
      badge: "满额闭环",
      leadTitle: "满额闭环 · 消除欠账并超前锁定明日战线",
      subLead: "三环同心 100% 满格对账 · 形成当日稳固快照",
      focusMode: "超额进阶核销",
      metrics: [
        { label: "净专注时长", value: "5.2h", unit: "/ 5.0h (104%)" },
        { label: "断层清零", value: "4/4", unit: "100% 闭合" },
        { label: "核心任务", value: "5/5", unit: "100% 达成" },
      ],
      primaryArtifact: "日终对账快照 · 零欠账",
      artifactStatus: "SURPLUS_RECONCILED",
      retentionScore: { before: 90, after: 98, grade: "GRADE S" },
      reconciliationStatus: "今日无遗留欠账，超前解锁明日级数专题",
      advice: "今日任务与复测全部高标准完成，明日可按计划进入下一阶段攻坚。",
      nextStep: "让日证据快照进入周期趋势",
      telemetry: {
        rings: [
          { id: "duration", label: "投入时长环", progress: 1.04, current: "5.2h", target: "5.0h", color: "#2dd4bf" },
          { id: "gaps", label: "断层闭合环", progress: 1.0, current: "4/4 清零", target: "4 总量", color: "#34d399" },
          { id: "tasks", label: "任务达成环", progress: 1.0, current: "5 达标", target: "5 计划", color: "#60a5fa" },
        ],
        closureStatus: "100% RECONCILED · 零欠账超前闭环",
        residualItems: [{ title: "高等数学级数专题", status: "明日已解锁" }],
      },
    },
    remedialTrack: {
      trackName: "暴露断层 · 补救路线",
      badge: "诚实对账",
      leadTitle: "诚实对账 · 债务可控与精准结转",
      subLead: "核销已闭合断层 · 未决事项排入明日优先复测池",
      focusMode: "债务结转核销",
      metrics: [
        { label: "专注投入", value: "4.2h", unit: "/ 5.0h (84%)" },
        { label: "断层闭合", value: "3/4", unit: "75% 解决" },
        { label: "核心任务", value: "4/5", unit: "80% 达成" },
      ],
      primaryArtifact: "日终对账快照 · 债务结转",
      artifactStatus: "MANAGED_DEBT_RECONCILED",
      retentionScore: { before: 65, after: 84, grade: "GRADE B+" },
      reconciliationStatus: "未决断层已精准排入明日 08:30 专项复测池",
      advice: "欠账已建立追踪凭据，不焦虑不放弃，明日首要任务优先攻关结转项。",
      nextStep: "让带欠账快照进入周期趋势",
      telemetry: {
        rings: [
          { id: "duration", label: "投入时长环", progress: 0.84, current: "4.2h", target: "5.0h", color: "#2dd4bf" },
          { id: "gaps", label: "断层闭合环", progress: 0.75, current: "3 闭合", target: "4 总量", color: "#fbbf24" },
          { id: "tasks", label: "任务达成环", progress: 0.8, current: "4 达成", target: "5 计划", color: "#34d399" },
        ],
        closureStatus: "RECONCILED · 债务受控已结转",
        residualItems: [{ title: "泰勒展开余项证明", status: "排入明日 08:30" }],
      },
    },
    telemetry: {
      rings: [
        { id: "duration", label: "投入时长环", progress: 0.84, current: "4.2h", target: "5.0h", color: "#2dd4bf" },
        { id: "gaps", label: "断层闭合环", progress: 0.75, current: "3 闭合", target: "4 总量", color: "#fbbf24" },
        { id: "tasks", label: "任务达成环", progress: 1.0, current: "5 达标", target: "5 计划", color: "#34d399" },
      ],
      closureStatus: "TODAY RECONCILED · 今日闭环已锁存",
      residualItems: [{ title: "泰勒展开余项证明", status: "已排入明日复测池" }],
    },
  },
  {
    id: "adjust",
    scene: "trend",
    step: 6,
    navTitle: "阶段调整",
    enNavTitle: "MACRO TREND & ADJUST",
    kicker: "STEP 06 / 06 · 宏观修正",
    title: "趋势提出建议，决定仍由你确认",
    subtitle: "14日多维曲线趋势与动态策略回流",
    desc: "周期报告汇总投入、欠账和掌握变化，生成待确认的下一阶段调整建议，并回流到下一次开始学习。",
    statusPill: "置信走廊 · 稳步上扬",
    statusPillType: "corridor",
    inputLabel: "承接",
    inputValue: "日证据快照",
    actionLabel: "识别周期偏差",
    outputLabel: "形成",
    outputValue: "待确认调整",
    nextLabel: "确认后回到下一次开始学习",
    accent: "#c084fc",
    accentRgb: "192, 132, 252",
    accentSoft: "rgba(192, 132, 252, 0.15)",
    textClass: "text-purple-300",
    lineClass: "bg-purple-400",
    borderClass: "border-purple-400/60",
    glowClass: "bg-purple-500/15",
    icon: LineChart,
    metrics: [
      { label: "14日掌握趋势", value: "+16.4%", unit: "SURGE" },
      { label: "置信稳定性", value: "98.2%", unit: "BOUND" },
      { label: "回流建议", value: "待确认", unit: "PROPOSAL" },
    ],
    masteryTrack: {
      trackName: "掌握良好 · 进阶路线",
      badge: "优势扩展",
      leadTitle: "优势扩展 · 提速冲刺与真题难度升级",
      subLead: "14 日高等数学掌握度稳步提升 (+23%) · 置信走廊持续收窄",
      focusMode: "攻坚权重调优",
      metrics: [
        { label: "14日趋势", value: "+23.4%", unit: "稳步跃升" },
        { label: "置信稳定性", value: "98.5%", unit: "高置信" },
        { label: "策略建议", value: "大题增重", unit: "待确认" },
      ],
      primaryArtifact: "阶段策略调整案 · 进阶冲顶",
      artifactStatus: "PROPOSAL_READY",
      retentionScore: { before: 75, after: 94, grade: "GRADE S" },
      reconciliationStatus: "确认后立即重构下周计划并回流",
      advice: "高数基础模块掌握扎实，建议将 40% 时间倾斜至「真题综合压轴题组」，加速冲顶。",
      nextStep: "确认后回到 STEP 01 开始新一轮攻坚",
      telemetry: {
        splines: [
          { subject: "高等数学", color: "#60a5fa", delta: "+23.4%", points: [45, 52, 65, 72, 80, 86, 94] },
          { subject: "408 计算机", color: "#2dd4bf", delta: "+15.2%", points: [50, 58, 62, 70, 78, 82, 88] },
          { subject: "考研英语", color: "#c084fc", delta: "+11.5%", points: [60, 64, 68, 72, 76, 80, 86] },
        ],
        currentProposal: "建议在下一周期将「真题综合大题与反常积分证明」权重提升至 40%，实现高分冲顶。",
        loopbackTarget: "STEP 01: 开始学习 · 锁定新一轮攻坚目标",
      },
    },
    remedialTrack: {
      trackName: "暴露断层 · 补救路线",
      badge: "瓶颈攻坚",
      leadTitle: "瓶颈攻坚 · 权重倾斜与专项补强",
      subLead: "识别周期性反复断层 · 自动生成靶向补强专题包",
      focusMode: "断层补强调优",
      metrics: [
        { label: "14日趋势", value: "+8.2%", unit: "平台期" },
        { label: "反复断层", value: "反常积分", unit: "需加固" },
        { label: "策略建议", value: "复测倾斜", unit: "待确认" },
      ],
      primaryArtifact: "阶段策略调整案 · 专项补强",
      artifactStatus: "PROPOSAL_READY",
      retentionScore: { before: 55, after: 72, grade: "GRADE B" },
      reconciliationStatus: "确认后自动生成补强专题包并回流",
      advice: "检测到反常积分审敛存在复测反复，建议下阶段增加 35% 专项复测权重，插入 3 天补强冲刺。",
      nextStep: "确认后回到 STEP 01 开始靶向补强",
      telemetry: {
        splines: [
          { subject: "高等数学", color: "#60a5fa", delta: "+8.2%", points: [35, 38, 42, 45, 52, 55, 60] },
          { subject: "408 计算机", color: "#2dd4bf", delta: "+10.1%", points: [40, 45, 48, 55, 60, 65, 72] },
          { subject: "考研英语", color: "#c084fc", delta: "+7.4%", points: [50, 52, 55, 58, 62, 64, 68] },
        ],
        currentProposal: "检测到「反常积分与极限存在性」存在周期性反复断层，建议下阶段增加 35% 专项复测权重。",
        loopbackTarget: "STEP 01: 开始学习 · 启动专项补强专题",
      },
    },
    telemetry: {
      splines: [
        { subject: "高等数学", color: "#60a5fa", delta: "+16.4%", points: [35, 42, 58, 62, 70, 78, 88] },
        { subject: "408 计算机", color: "#2dd4bf", delta: "+12.1%", points: [40, 48, 52, 60, 68, 72, 80] },
        { subject: "考研英语", color: "#c084fc", delta: "+9.8%", points: [55, 58, 64, 66, 72, 75, 82] },
      ],
      currentProposal: "建议在下一周期将「极限定理与连续性」的复测权重提升至 35%，保持稳态攻坚。",
      loopbackTarget: "STEP 01: 开始学习 · 锁定新一轮目标",
    },
  },
] as const;

export const LEARNING_LOOP_DURATION_MS = 6_000;
