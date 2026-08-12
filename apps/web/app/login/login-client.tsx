"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { LoginForm } from "@/components/login-form";
import { Target, Clock, BrainCircuit, CheckCircle2, LineChart, Workflow, Hexagon } from "lucide-react";

const LEARNING_LOOP_NODES = [
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
    icon: Hexagon,
    metrics: [
      { label: "系统状态", value: "在线运行" },
      { label: "AI 引擎", value: "全功率" },
      { label: "数据加密", value: "已开启" },
      { label: "本地同步", value: "实时互联" }
    ],
    hudTopLeftLabel: "SYS",
    hudTopLeftValue: "MEM: 0x7F9A",
    hudRightText: "SYS.OVERRIDE : OK",
    features: [
      "[架构] 核心引擎常驻运行，进程免打扰",
      "[加密] 端到端离线安全壳，护城河协议",
      "[链路] 跨节点事件流双向通信机制"
    ]
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
    icon: Target,
    metrics: [
      { label: "本轮目标", value: "已锁定" },
      { label: "任务边界", value: "绝对隔离" },
      { label: "预估耗时", value: "精密测算" },
      { label: "执行级别", value: "最高 (P0)" }
    ],
    hudTopLeftLabel: "LOCK",
    hudTopLeftValue: "TRG: 0x2A1B",
    hudRightText: "TARGET.LOCK : ACTIVE",
    features: [
      "[域锁定] 强行划定本次专注区间与靶向目标",
      "[资源流] 预加载知识锚点，切断非必要内存",
      "[强制力] 无明确目标则系统拒绝启动心流引擎"
    ]
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
    icon: Clock,
    metrics: [
      { label: "心流深度", value: "极度沉浸" },
      { label: "外部干扰", value: "全面屏蔽" },
      { label: "状态追踪", value: "本地优先" },
      { label: "当前模态", value: "绝对心流" }
    ],
    hudTopLeftLabel: "FLOW",
    hudTopLeftValue: "ISL: 0x9F4C",
    hudRightText: "DISTRACTION : BLOCKED",
    features: [
      "[隔离舱] 阻隔网页跳转与无关上下文切换",
      "[原子针] 毫秒级防休眠本地硬核计时器",
      "[心流态] 绘制极度沉浸深度与精力消耗图谱"
    ]
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
    icon: BrainCircuit,
    metrics: [
      { label: "掌握验证", value: "严苛标准" },
      { label: "客观证据", value: "强制提取" },
      { label: "知识提取", value: "动态测算" },
      { label: "知识幻觉", value: "无情打破" }
    ],
    hudTopLeftLabel: "SCAN",
    hudTopLeftValue: "EXT: 0x4B2D",
    hudRightText: "DATA.EXTRACT : IN_PROGRESS",
    features: [
      "[反幻觉] 废除选择题错觉，强制冷启动默写提取",
      "[突触网] 随机抽测72小时前历史遗留盲区",
      "[纠缠态] 根据答题延迟重新计算记忆衰减指数"
    ]
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
    icon: CheckCircle2,
    metrics: [
      { label: "学习债务", value: "等待清算" },
      { label: "终极对账", value: "强制执行" },
      { label: "今日评分", value: "核算中" },
      { label: "系统模态", value: "准备休眠" }
    ],
    hudTopLeftLabel: "SYNC",
    hudTopLeftValue: "REC: 0x8C3E",
    hudRightText: "DEBT.CLEAR : REQUIRED",
    features: [
      "[清算场] 扫描全天候碎片数据与悬而未决任务",
      "[零宽容] 延期债务红牌警告与信誉扣除协议",
      "[安全锁] 必须确认所有微服模块完结方可休眠"
    ]
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
    icon: LineChart,
    metrics: [
      { label: "周期报告", value: "已生成" },
      { label: "宏观视角", value: "全面展开" },
      { label: "战略调整", value: "引擎建议" },
      { label: "进化路线", value: "持续重塑" }
    ],
    hudTopLeftLabel: "EVAL",
    hudTopLeftValue: "ANL: 0x5D8F",
    hudRightText: "STRATEGY.EVOLVE : READY",
    features: [
      "[微观距] 分析近30天投入产出比与情绪波动差",
      "[预测机] 识别长期疲劳与路线偏离风险警报",
      "[自进化] 动态重构下周战略计划与兵力部署"
    ]
  }
];

export function LoginClient({ returnTo }: { returnTo: string }) {
  const [activeNodeIndex, setActiveNodeIndex] = useState(0);
  const [isLoginFocused, setIsLoginFocused] = useState(false);
  const [isWindowFocused, setIsWindowFocused] = useState(true);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const requestRef = useRef<number>(0);

  useEffect(() => {
    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => setIsWindowFocused(false);

    const handleMouseMove = (e: MouseEvent) => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      requestRef.current = requestAnimationFrame(() => {
        // Normalize mouse pos from -1 to 1 based on screen size
        const x = (e.clientX / window.innerWidth) * 2 - 1;
        const y = (e.clientY / window.innerHeight) * 2 - 1;
        setMousePos({ x, y });
      });
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("mousemove", handleMouseMove);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("mousemove", handleMouseMove);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  return (
    <main className="relative flex min-h-screen w-full bg-[#05080A] text-zinc-100 selection:bg-teal-500/30 overflow-hidden">
      
      {/* 沉浸式全局环境光 (根据 activeNode 动态渐变) */}
      <div className="absolute inset-0 z-0 pointer-events-none transition-opacity duration-1000" style={{ opacity: isLoginFocused ? 0.1 : 1 }}>
        <div 
          className={`absolute -left-[10%] top-[-10%] h-[1000px] w-[1000px] rounded-full blur-[150px] transition-colors duration-1000 ease-in-out ${LEARNING_LOOP_NODES[activeNodeIndex].glowClass}`}
          style={{ transform: `translate(${mousePos.x * -30}px, ${mousePos.y * -30}px)` }}
        ></div>
        <div 
          className="absolute right-[-10%] bottom-[-10%] h-[800px] w-[800px] rounded-full bg-cyan-900/10 blur-[150px]"
          style={{ transform: `translate(${mousePos.x * 20}px, ${mousePos.y * 20}px)` }}
        ></div>
      </div>

      {/* 微米级噪点遮罩层 (Micro Noise Dithering) 彻底消除大面积渐变导致的 Color Banding (色带阶梯现象) */}
      <div 
        className="absolute inset-0 z-0 pointer-events-none mix-blend-overlay opacity-[0.04]"
        style={{ 
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }}
      ></div>



      {/* 主体容器 (严格 8:2 布局) */}
      <div className="relative z-10 mx-auto w-full max-w-[2200px] grid grid-cols-1 lg:grid-cols-[1fr_400px] xl:grid-cols-[1fr_480px] items-center px-6 md:px-12 xl:px-20 min-h-screen gap-8 lg:gap-16">
        
        {/* ================= 左侧：学习闭环交互画卷 ================= */}
        <div 
          className={`flex h-full w-full flex-col justify-between py-12 transition-all duration-700 ease-in-out ${isLoginFocused ? 'opacity-30 blur-[4px] scale-[0.98] -translate-x-8 grayscale-[50%]' : 'opacity-100 blur-0 scale-100 translate-x-0 grayscale-0'}`}
        >
          {/* Header 品牌 */}
          <div className="mb-12 flex items-center gap-6 opacity-0 animate-slide-up-fade" style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}>
            <Image src="/brand/areaforge-logo-lockup.svg" alt="AreaForge Logo" width={300} height={98} className="h-12 md:h-16 w-auto object-contain drop-shadow-lg opacity-90 hover:opacity-100 transition-opacity" priority />
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-400 backdrop-blur-md shadow-sm">
              <span className={`h-2 w-2 rounded-full transition-colors duration-700 shadow-[0_0_8px_currentColor] ${LEARNING_LOOP_NODES[activeNodeIndex].lineClass}`}></span>
              v1.1.2 Production
            </div>
          </div>

          {/* 核心内容区 (绝对定位实现交叉渐变) */}
          <div className="relative flex-1 w-full min-h-[450px] opacity-0 animate-slide-up-fade" style={{ animationDelay: '300ms', animationFillMode: 'forwards' }}>
            {LEARNING_LOOP_NODES.map((node, index) => {
              const isActive = index === activeNodeIndex;
              return (
                <div 
                  key={node.id}
                  className={`absolute inset-0 flex flex-col justify-center transition-all duration-700 ease-in-out ${isActive ? 'opacity-100 translate-y-0 z-10 pointer-events-auto' : 'opacity-0 translate-y-8 z-0 pointer-events-none'}`}
                >
                  <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-8 items-center h-full">
                    {/* 左侧文字叙述 */}
                    <div className="max-w-xl 2xl:max-w-2xl relative pl-6 xl:pl-8">
                      {/* 左侧发光修饰线 */}
                      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-full ${node.lineClass} shadow-[0_0_15px_currentColor] opacity-80`}></div>
                      
                      {/* 终端系统头 (Terminal Header) */}
                      <div className="mb-3 inline-flex items-center gap-2 font-mono text-[10px] xl:text-xs font-bold tracking-widest text-zinc-500 uppercase">
                        <span className={`h-1.5 w-1.5 rounded-full ${node.lineClass} animate-pulse shadow-[0_0_8px_currentColor]`}></span>
                        [ SYS.MODULE : {node.id.toUpperCase()} ]
                      </div>

                      {/* 降维精细化标题 (Compact Module Title) */}
                      <h1 className="mb-4 text-2xl md:text-3xl xl:text-4xl font-bold leading-tight tracking-tight text-white drop-shadow-sm">
                        {node.title1}<br />
                        <span className={`text-transparent bg-clip-text bg-gradient-to-r drop-shadow-[0_0_15px_rgba(255,255,255,0.05)] transition-colors duration-700 ${node.colorClass}`}>
                          {node.title2}
                        </span>
                      </h1>
                      
                      {/* 终端日志式说明 (Terminal Log Description) */}
                      <p className="text-sm xl:text-[15px] leading-relaxed text-zinc-400/80 font-mono mb-8 max-w-[95%]">
                        <span className="text-zinc-600 mr-2 font-bold">&gt;</span>{node.desc}
                      </p>

                      {/* 动态核心监控指标 (Metrics Dashboard) */}
                      <div className="grid grid-cols-2 gap-3 xl:gap-4 animate-slide-up-fade" style={{ animationDelay: '200ms', animationFillMode: 'forwards' }}>
                        {node.metrics.map((metric, i) => (
                          <div key={i} className={`relative flex flex-col justify-center p-3 xl:p-4 bg-zinc-900/30 border border-white/5 backdrop-blur-md overflow-hidden ${node.glowClass}`}>
                            {/* 极客风格四角装饰 */}
                            <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-white/20"></div>
                            <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-white/20"></div>
                            
                            {/* 微型进度条装饰 */}
                            <div className={`absolute bottom-0 left-0 h-[1px] w-[30%] opacity-50 ${node.lineClass}`}></div>
                            
                            <span className="font-mono text-[9px] xl:text-[10px] text-zinc-500 tracking-widest uppercase mb-1">{metric.label}</span>
                            <span className={`font-mono text-xs xl:text-sm font-semibold tracking-wide ${node.textClass}`}>{metric.value}</span>
                          </div>
                        ))}
                      </div>
                      
                      {/* 极客终端负载说明模块 (Payload Features List) */}
                      <div className="mt-6 xl:mt-8 animate-slide-up-fade" style={{ animationDelay: '300ms', animationFillMode: 'forwards' }}>
                        <div className="text-[10px] xl:text-xs font-mono text-zinc-600 uppercase tracking-widest mb-3 border-b border-zinc-800 pb-2">
                          [ SYSTEM CAPABILITIES_ ]
                        </div>
                        <ul className="space-y-2 xl:space-y-3">
                          {node.features.map((feature, idx) => (
                            <li key={idx} className="flex items-start text-xs xl:text-sm font-mono text-zinc-400/90 tracking-tight group">
                              <span className={`mr-2 mt-0.5 text-[9px] xl:text-[10px] opacity-70 group-hover:opacity-100 transition-opacity ${node.textClass}`}>&gt;&gt;</span>
                              <span className="leading-relaxed group-hover:text-white transition-colors">{feature}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {/* 右侧巨大视觉组件化表达 */}
                    <div className="hidden lg:flex items-center justify-center relative w-[250px] xl:w-[400px] h-[250px] xl:h-[400px] shrink-0">
                      <div className="relative w-full h-full flex items-center justify-center">
                        
                        {/* ================= HUD 全局视窗边框与数据层 ================= */}
                        {/* 1. 底层战术坐标点阵网格 */}
                        <div className="absolute inset-[-20px] xl:inset-[-40px] pointer-events-none opacity-20" 
                             style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px)', backgroundSize: '16px 16px' }}></div>
                        
                        {/* 2. 四角机械外装甲边框 (L形) */}
                        <div className="absolute inset-[-10px] xl:inset-[-20px] pointer-events-none border border-white/5">
                          <div className="absolute top-0 left-0 w-6 h-6 xl:w-10 xl:h-10 border-t-2 border-l-2 border-zinc-500/50"></div>
                          <div className="absolute top-0 right-0 w-6 h-6 xl:w-10 xl:h-10 border-t-2 border-r-2 border-zinc-500/50"></div>
                          <div className="absolute bottom-0 left-0 w-6 h-6 xl:w-10 xl:h-10 border-b-2 border-l-2 border-zinc-500/50"></div>
                          <div className="absolute bottom-0 right-0 w-6 h-6 xl:w-10 xl:h-10 border-b-2 border-r-2 border-zinc-500/50"></div>
                        </div>

                        {/* 3. 瞄准十字线 */}
                        <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-10">
                          <div className="w-[120%] h-[1px] bg-white absolute"></div>
                          <div className="h-[120%] w-[1px] bg-white absolute"></div>
                        </div>

                        {/* 4. 左上角：悬浮遥测面板 - 状态指示 */}
                        <div className="absolute top-[-25px] left-[-10px] xl:top-[-40px] xl:left-[-20px] flex items-center space-x-2 pointer-events-none transition-all duration-500">
                          <div className="h-1.5 w-1.5 xl:h-2 xl:w-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.8)]" style={{ animationPlayState: isWindowFocused ? 'running' : 'paused' }}></div>
                          <span className="font-mono text-[10px] xl:text-xs font-bold text-zinc-400">{LEARNING_LOOP_NODES[activeNodeIndex].hudTopLeftLabel}</span>
                          <span className="font-mono text-[10px] xl:text-xs text-zinc-600 ml-4 hidden xl:inline-block">{LEARNING_LOOP_NODES[activeNodeIndex].hudTopLeftValue}</span>
                        </div>

                        {/* 5. 右下角：微型动态均衡器 */}
                        <div className="absolute bottom-[-25px] right-[-10px] xl:bottom-[-40px] xl:right-[-20px] flex items-end space-x-1 xl:space-x-1.5 pointer-events-none opacity-40 h-4 xl:h-6">
                          <div className="w-1 xl:w-1.5 bg-zinc-400 h-[40%] animate-pulse" style={{ animationPlayState: isWindowFocused ? 'running' : 'paused' }}></div>
                          <div className="w-1 xl:w-1.5 bg-zinc-400 h-[80%] animate-pulse" style={{ animationDuration: '0.7s', animationPlayState: isWindowFocused ? 'running' : 'paused' }}></div>
                          <div className="w-1 xl:w-1.5 bg-zinc-400 h-[60%] animate-pulse" style={{ animationDuration: '1.2s', animationPlayState: isWindowFocused ? 'running' : 'paused' }}></div>
                          <div className="w-1 xl:w-1.5 bg-zinc-400 h-[100%] animate-pulse" style={{ animationDuration: '0.8s', animationPlayState: isWindowFocused ? 'running' : 'paused' }}></div>
                          <div className="w-1 xl:w-1.5 bg-zinc-400 h-[30%] animate-pulse" style={{ animationDuration: '1.5s', animationPlayState: isWindowFocused ? 'running' : 'paused' }}></div>
                        </div>

                        {/* 6. 右侧边缘：垂直状态读数 */}
                        <div className="absolute top-1/4 right-[-30px] xl:right-[-50px] w-4 pointer-events-none flex flex-col items-center opacity-30 transition-all duration-500">
                          <span className="font-mono text-[8px] xl:text-[10px] text-zinc-400 rotate-90 whitespace-nowrap origin-left mt-8 tracking-widest">{LEARNING_LOOP_NODES[activeNodeIndex].hudRightText}</span>
                          <div className="h-16 w-[1px] bg-zinc-600 mt-16"></div>
                        </div>
                        {/* ================= HUD 全局视窗边框 结束 ================= */}

                        {node.id === "overview" && (
                          <div className="relative flex h-full w-full items-center justify-center">
                            {/* 强力背景环境光斑 */}
                            <div className="absolute inset-0 rounded-full bg-teal-500/10 blur-3xl animate-pulse" style={{ animationPlayState: isWindowFocused ? 'running' : 'paused' }}></div>
                            
                            {/* SVG 雷达刻度网格 */}
                            <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full opacity-30 animate-[spin_60s_linear_infinite]" style={{ animationPlayState: isWindowFocused ? 'running' : 'paused' }}>
                              <circle cx="200" cy="200" r="190" stroke="currentColor" strokeWidth="1" fill="none" className="text-teal-500" strokeDasharray="4 8" />
                              <circle cx="200" cy="200" r="140" stroke="currentColor" strokeWidth="1" fill="none" className="text-cyan-500" strokeDasharray="1 4" />
                              <path d="M 200 10 L 200 390 M 10 200 L 390 200" stroke="currentColor" strokeWidth="1" className="text-teal-500/50" />
                              {/* 细密刻度 */}
                              {[...Array(36)].map((_, i) => (
                                <line key={i} x1="200" y1="10" x2="200" y2="20" stroke="currentColor" strokeWidth="2" className="text-teal-400" transform={`rotate(${i * 10} 200 200)`} />
                              ))}
                            </svg>

                            {/* 外环: 战术护盾 */}
                            <div className="absolute h-[80%] w-[80%] rounded-full border-y-[3px] border-x-[1px] border-teal-500/60 animate-[spin_15s_ease-in-out_infinite_alternate]" style={{ animationPlayState: isWindowFocused ? 'running' : 'paused' }}></div>
                            
                            {/* 中环: 流光粗轨 (反向) */}
                            <div className="absolute h-[60%] w-[60%] rounded-full border-[6px] border-cyan-500/10 border-l-cyan-400 shadow-[0_0_40px_rgba(34,211,238,0.4)] animate-[spin_8s_linear_infinite_reverse]" style={{ animationPlayState: isWindowFocused ? 'running' : 'paused' }}></div>
                            
                            {/* 内环: 高强度核心防护环 */}
                            <div className="absolute h-[35%] w-[35%] rounded-full border-[12px] border-blue-500/30 border-t-blue-400 shadow-[0_0_60px_rgba(59,130,246,0.8)] animate-[spin_3s_linear_infinite]" style={{ animationPlayState: isWindowFocused ? 'running' : 'paused' }}></div>
                            
                            {/* 核心: 发光六边形 */}
                            <div className="absolute h-[25%] w-[25%] bg-teal-500/20 backdrop-blur-md rounded-lg flex items-center justify-center border border-teal-300/50 shadow-[0_0_30px_rgba(45,212,191,1)] z-20 animate-pulse">
                              <Hexagon className="h-2/3 w-2/3 text-white drop-shadow-[0_0_10px_white]" fill="currentColor" fillOpacity={0.8} />
                            </div>
                            
                            {/* 轨道粒子群 */}
                            <div className="absolute h-[85%] w-[85%] animate-[spin_12s_linear_infinite]" style={{ animationPlayState: isWindowFocused ? 'running' : 'paused' }}>
                              <div className="absolute top-[15%] right-[15%] h-2 w-2 xl:h-3 xl:w-3 rounded-full bg-cyan-300 shadow-[0_0_20px_rgba(103,232,249,1)]"></div>
                              <div className="absolute bottom-[5%] left-[45%] h-1.5 w-1.5 xl:h-2 xl:w-2 rounded-full bg-teal-300 shadow-[0_0_15px_rgba(45,212,191,1)]"></div>
                            </div>
                          </div>
                        )}

                        {node.id === "plan" && (
                          <div className="relative flex h-[85%] w-[85%] items-center justify-center">
                            {/* 战术锁定框 */}
                            <div className="absolute inset-0 border-2 border-blue-500/30">
                              <div className="absolute top-[-2px] left-[-2px] w-8 h-8 border-t-4 border-l-4 border-blue-400"></div>
                              <div className="absolute top-[-2px] right-[-2px] w-8 h-8 border-t-4 border-r-4 border-blue-400"></div>
                              <div className="absolute bottom-[-2px] left-[-2px] w-8 h-8 border-b-4 border-l-4 border-blue-400"></div>
                              <div className="absolute bottom-[-2px] right-[-2px] w-8 h-8 border-b-4 border-r-4 border-blue-400"></div>
                            </div>
                            
                            {/* 雷达扇区扫描 */}
                            <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full animate-[spin_4s_linear_infinite]" style={{ animationPlayState: isWindowFocused ? 'running' : 'paused' }}>
                              <path d="M 100 100 L 100 0 A 100 100 0 0 1 170.7 29.3 Z" fill="url(#radar-gradient)" className="opacity-40" />
                              <defs>
                                <radialGradient id="radar-gradient" cx="50%" cy="50%" r="50%">
                                  <stop offset="0%" stopColor="rgba(59,130,246,1)" />
                                  <stop offset="100%" stopColor="rgba(59,130,246,0)" />
                                </radialGradient>
                              </defs>
                            </svg>

                            <Target className="absolute h-[60%] w-[60%] text-blue-400/80 stroke-1 drop-shadow-[0_0_30px_rgba(59,130,246,0.6)] animate-pulse" />
                            <div className="absolute h-[55%] w-[55%] rounded-full border-[3px] border-blue-400/80 border-dashed animate-[spin_15s_linear_infinite_reverse]" style={{ animationPlayState: isWindowFocused ? 'running' : 'paused' }}></div>
                            <div className="absolute h-[25%] w-[25%] rounded-full border-[4px] border-indigo-400 shadow-[0_0_40px_rgba(99,102,241,0.8)]"></div>
                            <div className="absolute h-[6%] w-[6%] rounded-full bg-white shadow-[0_0_30px_rgba(255,255,255,1)] animate-ping" style={{ animationPlayState: isWindowFocused ? 'running' : 'paused' }}></div>
                          </div>
                        )}

                        {node.id === "focus" && (
                          <div className="relative flex h-[95%] w-[95%] items-center justify-center rounded-full border-[6px] xl:border-[8px] border-zinc-800/90 shadow-[0_0_80px_rgba(45,212,191,0.3)] bg-zinc-900/30 backdrop-blur-sm">
                            <svg viewBox="0 0 380 380" className="absolute inset-0 h-full w-full -rotate-90 overflow-visible">
                              {/* 内侧精细秒表刻度 */}
                              {[...Array(60)].map((_, i) => (
                                <line key={i} x1="190" y1="35" x2="190" y2={i % 5 === 0 ? "45" : "40"} stroke="currentColor" strokeWidth={i % 5 === 0 ? "3" : "1"} className={i % 5 === 0 ? "text-cyan-400" : "text-zinc-600"} transform={`rotate(${i * 6} 190 190)`} />
                              ))}
                              
                              <circle cx="190" cy="190" r="174" stroke="currentColor" strokeWidth="12" fill="none" className="text-teal-400 stroke-[12px] drop-shadow-[0_0_20px_rgba(45,212,191,0.8)]" strokeDasharray="1093" strokeDashoffset="250" strokeLinecap="round" />
                              
                              {/* 旋转雷达指针 */}
                              <g className="animate-[spin_2s_linear_infinite]" style={{ transformOrigin: '190px 190px', animationPlayState: isWindowFocused ? 'running' : 'paused' }}>
                                <line x1="190" y1="190" x2="190" y2="40" stroke="rgba(34,211,238,0.5)" strokeWidth="2" />
                                <polygon points="187,40 193,40 190,30" fill="rgba(34,211,238,0.8)" />
                              </g>
                            </svg>
                            <span className="text-5xl xl:text-[72px] font-black tracking-tighter text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.6)] z-10">45:00</span>
                          </div>
                        )}

                        {node.id === "retest" && (
                          <div className="relative h-[90%] w-[90%] flex items-center justify-center">
                            {/* 复杂的神经突触底层连线 */}
                            <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full opacity-90 overflow-visible" stroke="currentColor" strokeWidth="3" fill="none">
                              <path id="path1" d="M 50 200 C 100 100, 150 200, 200 200" className="text-cyan-500/40" />
                              <path id="path2" d="M 200 200 C 250 200, 300 300, 350 200" className="text-blue-500/40" />
                              <path id="path3" d="M 100 300 L 200 200 L 300 100" className="text-teal-500/40 stroke-dashed" strokeDasharray="6,6" />
                              
                              {/* 光梭游走动画 */}
                              <circle r="6" fill="currentColor" className="text-cyan-300 drop-shadow-[0_0_15px_rgba(103,232,249,1)]">
                                <animateMotion dur="3s" repeatCount="indefinite">
                                  <mpath href="#path1" />
                                </animateMotion>
                              </circle>
                              <circle r="6" fill="currentColor" className="text-blue-300 drop-shadow-[0_0_15px_rgba(147,197,253,1)]">
                                <animateMotion dur="4s" repeatCount="indefinite">
                                  <mpath href="#path2" />
                                </animateMotion>
                              </circle>
                              <circle r="6" fill="currentColor" className="text-teal-300 drop-shadow-[0_0_15px_rgba(94,234,212,1)]">
                                <animateMotion dur="2.5s" repeatCount="indefinite">
                                  <mpath href="#path3" />
                                </animateMotion>
                              </circle>
                            </svg>
                            
                            {/* 中心突触核心 */}
                            <div className="relative h-[30%] w-[30%] rounded-full bg-zinc-900/80 border-[4px] border-cyan-400 shadow-[0_0_60px_rgba(34,211,238,0.5)] z-10 flex items-center justify-center backdrop-blur-md">
                              <BrainCircuit className="h-1/2 w-1/2 text-cyan-400 animate-pulse" />
                            </div>
                            
                            {/* 外围漂浮的记忆碎片 */}
                            <div className="absolute left-[10%] top-[20%] h-[12%] w-[12%] rounded-sm border-2 border-blue-400 bg-blue-500/20 backdrop-blur-sm z-10 shadow-[0_0_30px_rgba(59,130,246,0.6)] animate-[bounce_4s_infinite]"></div>
                            <div className="absolute right-[15%] bottom-[25%] h-[8%] w-[8%] rounded-full bg-teal-400/80 z-10 shadow-[0_0_20px_rgba(45,212,191,0.8)] animate-[bounce_3s_infinite_0.5s]"></div>
                          </div>
                        )}

                        {node.id === "closeout" && (
                          <div className="relative flex h-[90%] w-[90%] items-center justify-center">
                            {/* 数据封锁保险闸门动画 */}
                            <div className="absolute inset-0 rounded-full border-[10px] border-emerald-500/20 bg-emerald-900/20 shadow-[inset_0_0_50px_rgba(16,185,129,0.3)] backdrop-blur-sm"></div>
                            
                            <div className="absolute h-[80%] w-[80%] rounded-full border-t-[8px] border-b-[8px] border-emerald-400 animate-[spin_6s_ease-in-out_infinite]" style={{ animationPlayState: isWindowFocused ? 'running' : 'paused' }}></div>
                            <div className="absolute h-[65%] w-[65%] rounded-full border-l-[6px] border-r-[6px] border-teal-300 animate-[spin_4s_ease-in-out_infinite_reverse]" style={{ animationPlayState: isWindowFocused ? 'running' : 'paused' }}></div>
                            
                            {/* 中心确认印章 */}
                            <div className="relative h-[40%] w-[40%] rounded-full bg-emerald-500 shadow-[0_0_80px_rgba(16,185,129,0.8)] z-10 flex items-center justify-center border-4 border-white/20">
                              <CheckCircle2 className="h-2/3 w-2/3 text-white drop-shadow-[0_0_15px_rgba(255,255,255,1)]" strokeWidth="2.5" />
                            </div>
                            
                            {/* 成功粒子向外发射 */}
                            <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full opacity-60">
                              {[...Array(8)].map((_, i) => (
                                <line key={i} x1="100" y1="100" x2="100" y2="10" stroke="currentColor" strokeWidth="3" className="text-emerald-300" strokeDasharray="10 20" transform={`rotate(${i * 45} 100 100)`}>
                                  <animate attributeName="stroke-dashoffset" from="30" to="0" dur="1s" repeatCount="indefinite" />
                                </line>
                              ))}
                            </svg>
                          </div>
                        )}

                        {node.id === "adjust" && (
                          <div className="relative flex h-[90%] w-[90%] items-center justify-center">
                            {/* 全息三维投影网格底座 */}
                            <div className="absolute bottom-[10%] w-[120%] h-[30%] bg-fuchsia-500/10 rounded-full blur-xl animate-pulse"></div>
                            
                            <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full overflow-visible">
                              {/* 投影光束 */}
                              <polygon points="200,350 50,150 350,150" fill="url(#beam-gradient)" className="opacity-40" />
                              <defs>
                                <linearGradient id="beam-gradient" x1="0%" y1="100%" x2="0%" y2="0%">
                                  <stop offset="0%" stopColor="rgba(232,121,249,0.5)" />
                                  <stop offset="100%" stopColor="rgba(232,121,249,0)" />
                                </linearGradient>
                              </defs>
                              
                              {/* 动态折线图数据趋势 */}
                              <polyline points="50,250 150,180 250,220 350,100" fill="none" stroke="currentColor" strokeWidth="6" className="text-violet-400 drop-shadow-[0_0_15px_rgba(139,92,246,0.8)] stroke-dasharray-[1000] stroke-dashoffset-[1000]">
                                <animate attributeName="stroke-dashoffset" from="1000" to="0" dur="3s" fill="freeze" />
                              </polyline>
                              
                              {/* 数据节点发光球 */}
                              <circle cx="150" cy="180" r="8" fill="white" className="drop-shadow-[0_0_10px_white] animate-pulse" />
                              <circle cx="250" cy="220" r="8" fill="white" className="drop-shadow-[0_0_10px_white] animate-pulse" />
                              <circle cx="350" cy="100" r="12" fill="white" className="text-fuchsia-300 drop-shadow-[0_0_20px_rgba(232,121,249,1)]" />
                            </svg>
                            
                            {/* 主控图标悬浮 */}
                            <LineChart className="absolute top-[10%] right-[10%] h-[25%] w-[25%] text-fuchsia-300 drop-shadow-[0_0_30px_rgba(232,121,249,0.8)] animate-bounce" style={{ animationDuration: '3s' }} strokeWidth="2" />
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 底部线路图 (Journey Map Progress Line) */}
          <div 
            className="mt-8 md:mt-16 mb-8 relative w-full opacity-0 animate-fade-in-up" 
            style={{ animationDelay: '600ms', animationFillMode: 'forwards' }}
            onMouseLeave={() => setActiveNodeIndex(0)}
          >
             {/* 轨道层 */}
             <div className="absolute top-1/2 left-[20px] right-[20px] h-1 -translate-y-1/2">
               <div className="absolute inset-0 bg-white/10 rounded-full"></div>
               <div 
                 className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500 via-cyan-400 to-fuchsia-500 rounded-full transition-all duration-700 ease-out"
                 style={{ width: activeNodeIndex === 0 ? '0%' : `${((activeNodeIndex - 1) / (LEARNING_LOOP_NODES.length - 2)) * 100}%` }}
               ></div>
             </div>

             {/* 线路节点 */}
             <div className="relative z-10 flex items-center justify-between w-full">
               {LEARNING_LOOP_NODES.slice(1).map((node, i) => {
                 const actualIndex = i + 1;
                 const isActive = actualIndex === activeNodeIndex;
                 const isPast = activeNodeIndex !== 0 && actualIndex <= activeNodeIndex;
                 const Icon = node.icon;
                 
                 return (
                   <div 
                     key={node.id} 
                     className="flex flex-col items-center gap-4 cursor-pointer group -mt-4 outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-8 focus-visible:ring-offset-[#05080A] rounded-lg"
                     onMouseEnter={() => setActiveNodeIndex(actualIndex)}
                     tabIndex={0}
                     onFocus={() => setActiveNodeIndex(actualIndex)}
                     onKeyDown={(e) => {
                       if (e.key === 'Enter' || e.key === ' ') {
                         e.preventDefault();
                         setActiveNodeIndex(actualIndex);
                       }
                     }}
                   >
                     {/* 节点原点 */}
                     <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all duration-500 ${isPast ? `bg-[#05080A] ${node.borderClass} shadow-[0_0_20px_rgba(255,255,255,0.1)]` : 'bg-zinc-900/80 border-zinc-700 group-hover:border-zinc-500 group-hover:bg-zinc-800'}`}>
                       {isActive ? (
                         <div className={`w-4 h-4 rounded-full ${node.lineClass} animate-pulse shadow-[0_0_10px_currentColor]`}></div>
                       ) : isPast ? (
                         <Icon className={`h-4 w-4 ${node.textClass}`} strokeWidth={3} />
                       ) : (
                         <div className="w-2 h-2 rounded-full bg-zinc-600 group-hover:bg-zinc-400 transition-colors"></div>
                       )}
                     </div>
                     {/* 节点文字 */}
                     <span className={`text-xs md:text-sm font-bold tracking-wide transition-colors duration-500 ${isActive ? `${node.textClass} drop-shadow-[0_0_8px_currentColor]` : isPast ? 'text-zinc-300' : 'text-zinc-600 group-hover:text-zinc-400'}`}>
                       {node.navTitle}
                     </span>
                   </div>
                 );
               })}
             </div>
          </div>
        </div>

        {/* ================= 右侧表单区 (Focus Mode Trigger) ================= */}
        <div 
          className="flex w-full shrink-0 justify-center opacity-0 animate-fade-in-up" 
          style={{ animationDelay: '900ms', animationFillMode: 'forwards' }}
          onMouseEnter={() => setIsLoginFocused(true)}
          onMouseLeave={() => setIsLoginFocused(false)}
          onFocus={() => setIsLoginFocused(true)}
          onBlur={() => setIsLoginFocused(false)}
        >
          <div className="relative w-full group">
            {/* 炫酷底座光晕 (联动当前激活节点的颜色) */}
            <div className={`absolute -inset-1 z-0 rounded-[2.5rem] transition-all duration-700 ease-out bg-gradient-to-b ${LEARNING_LOOP_NODES[activeNodeIndex].colorClass} ${isLoginFocused ? 'opacity-20 scale-[1.02] blur-2xl' : 'opacity-10 scale-95 blur-xl'}`}></div>
            
            {/* 悬浮玻璃面板 */}
            <div className={`relative z-10 w-full overflow-hidden rounded-[2.5rem] border p-8 sm:p-10 backdrop-blur-2xl transition-all duration-700 ease-out ${isLoginFocused ? `border-white/20 shadow-[0_0_80px_rgba(0,0,0,0.6)] bg-[#05080A]/80 translate-y-0 scale-100` : 'border-white/10 shadow-[0_8px_40px_rgba(0,0,0,0.5)] bg-white/[0.02] translate-y-2 scale-95'}`}>
              
              <div className={`login-form-container transition-all duration-700 ${isLoginFocused ? 'opacity-100' : 'opacity-80 grayscale-[20%]'}`}>
                <LoginForm returnTo={returnTo} />
              </div>
              
              {/* 当未聚焦时，显示一个微微发光的遮罩提示交互 */}
              {!isLoginFocused && (
                <div className="absolute inset-0 z-20 hidden lg:flex items-center justify-center pointer-events-none rounded-[2.5rem] border border-white/5 bg-black/10 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <span className="text-sm font-medium tracking-widest text-zinc-300 drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]">Click or Hover to Unlock</span>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}
