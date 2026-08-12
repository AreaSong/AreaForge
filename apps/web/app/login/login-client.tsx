"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { LoginForm } from "@/components/login-form";
import { Target, Clock, BrainCircuit, CheckCircle2, LineChart, Workflow, Hexagon } from "lucide-react";

import { NeuralPulse } from "./components/neural-pulse";
import { RadarEngine } from "./components/radar-engine";
import { DataMatrix } from "./components/data-matrix";
import { SystemNetwork } from "./components/system-network";
import { TrendLine } from "./components/trend-line";

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

// 巨型舞台动画组件 (Showcase Stage Animations)
const ShowcaseStage = ({ node, isActive }: { node: any, isActive: boolean }) => {
  const isOverview = node.id === 'overview';

  return (
    <div className={`w-full h-full relative overflow-hidden flex transition-opacity duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${isActive ? 'opacity-100 z-10' : 'opacity-0 -z-10'}`}>
      
      {/* 极简氛围装饰 */}
      <div className={`absolute left-8 top-[30%] bottom-[30%] w-1.5 rounded-full ${node.lineClass} shadow-[0_0_25px_currentColor] opacity-90 transition-opacity duration-500 ${isOverview ? 'opacity-100' : 'opacity-0'}`}></div>
      <div className={`absolute inset-0 bg-gradient-to-br ${node.colorClass} opacity-[0.03]`}></div>

      {/* ==================== 首页/系统核心态 (文字主导) ==================== */}
      {isOverview && (
        <div className="w-full h-full flex items-center justify-between px-8 xl:px-12 py-6 relative">
          
          {/* 全局居中的巨大背景 Logo (氛围装饰) */}
          <div className="absolute inset-0 flex items-center justify-center opacity-[0.12] pointer-events-none">
            <node.icon className={`w-[400px] h-[400px] xl:w-[480px] xl:h-[480px] ${node.textClass} animate-[spin_60s_linear_infinite] drop-shadow-[0_0_30px_currentColor]`} />
          </div>

          {/* 左侧：核心系统描述 (w-[45%]) */}
          <div className="w-[45%] flex flex-col justify-center pl-6 z-20 relative">
            <div className="mb-4 inline-flex items-center gap-3 font-mono text-[11px] xl:text-[13px] font-bold tracking-[0.2em] text-zinc-400 uppercase">
              <span className={`h-2 w-2 rounded-full ${node.lineClass} animate-pulse shadow-[0_0_12px_currentColor]`}></span>
              [ SYS.MODULE : {node.id.toUpperCase()} ]
            </div>

            <h1 className="mb-6 text-3xl md:text-4xl xl:text-5xl font-black leading-tight tracking-tight text-white drop-shadow-md">
              {node.title1}<br />
              <span className={`text-transparent bg-clip-text bg-gradient-to-r drop-shadow-[0_0_20px_rgba(255,255,255,0.1)] transition-colors duration-1000 ${node.colorClass}`}>
                {node.title2}
              </span>
            </h1>
            
            <p className="text-sm xl:text-lg leading-relaxed text-zinc-300 font-mono max-w-xl border-l-2 border-zinc-800/80 pl-5 py-2">
              {node.desc}
            </p>
          </div>

          {/* 右侧：HUD 数据终端风格模块 (w-[45%]) */}
          <div className="w-[45%] h-full flex items-center justify-end z-20 relative">
            <div className="flex flex-col justify-center gap-6 xl:gap-8 w-full max-w-sm border-l border-white/5 pl-8 lg:pl-10">
              {[
                 { title: '硬核计时引擎', desc: '隔绝干扰记录纯净心流' },
                 { title: '强制证据对账', desc: '冷启动默写打破知识幻觉' },
                 { title: '今日债务清算', desc: '绝不将未决任务留给明天' },
                 { title: '周期战略重塑', desc: '基于微观数据动态纠正偏差' }
              ].map((item, i) => (
                <div key={i} className="flex flex-col gap-1.5 group cursor-default">
                   <div className="flex items-center gap-3">
                     <div className="w-1.5 h-1.5 rounded-full bg-teal-400 shadow-[0_0_8px_#2dd4bf] group-hover:animate-ping"></div>
                     <div className="font-mono text-sm md:text-base font-bold text-teal-400/90 tracking-widest">{item.title}</div>
                   </div>
                   <div className="text-xs text-zinc-500 font-mono pl-4 border-l-2 border-transparent ml-[2px] py-0.5 group-hover:border-teal-500/30 group-hover:text-zinc-400 transition-colors">{item.desc}</div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* ==================== 路线图节点态 (纯动态全景内容) ==================== */}
      {!isOverview && (
        <div className="w-full h-full relative flex items-center justify-center p-8">
           {/* 全局小标签 */}
           <div className="absolute top-8 left-10 z-50 pointer-events-none">
             <div className="inline-flex items-center gap-3 font-mono text-xs font-bold tracking-[0.2em] text-zinc-500 uppercase">
                <span className={`h-2 w-2 rounded-full ${node.lineClass} shadow-[0_0_12px_currentColor] animate-pulse`}></span>
                {node.title1}
                <span className={node.textClass}>{node.title2}</span>
             </div>
           </div>
           
           {/* 超大全景画布 */}
           <div className={`w-full h-full flex items-center justify-center relative transition-all duration-1000 ${isActive ? 'scale-100 opacity-100' : 'scale-110 opacity-0'}`}>
              
              {node.id === 'focus' && <NeuralPulse colorClass={node.colorClass} textClass={node.textClass} />}

              {node.id === 'plan' && <RadarEngine lineClass={node.lineClass} textClass={node.textClass} />}

              {node.id === 'retest' && <DataMatrix colorClass={node.colorClass} textClass={node.textClass} />}

              {node.id === 'closeout' && <SystemNetwork textClass={node.textClass} />}

              {node.id === 'adjust' && <TrendLine textClass={node.textClass} />}
           </div>
        </div>
      )}

    </div>
  );
};


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
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`
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

          {/* ================= 聚光灯舞台与卡片网格重构区域 (Showcase Stage & Feature Cards) ================= */}
          <div className="relative flex-1 w-full min-h-[500px] flex flex-col pt-4">
            {LEARNING_LOOP_NODES.map((node, index) => {
              const isActive = index === activeNodeIndex;
              return (
                <div 
                  key={node.id}
                  className={`absolute inset-0 flex flex-col justify-between transition-all duration-[800ms] cubic-bezier(0.16, 1, 0.3, 1) ${isActive ? 'opacity-100 translate-x-0 z-10 pointer-events-auto' : 'opacity-0 -translate-x-12 z-0 pointer-events-none'}`}
                >
                  
                  {/* 上半部分：巨幅动画与展示舞台 (Showcase Stage) */}
                  <div className="flex-1 w-full relative rounded-2xl bg-gradient-to-b from-black/20 to-black/60 border border-white/5 backdrop-blur-md overflow-hidden shadow-2xl">
                    {/* 微光底纹 */}
                    <div className={`absolute inset-0 bg-gradient-to-br ${node.colorClass} opacity-5`}></div>
                    <ShowcaseStage node={node} isActive={isActive} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* 底部线路图 (Journey Map Progress Line) */}
          <div 
            className="mt-8 md:mt-16 mb-8 relative w-full opacity-0 animate-fade-in-up" 
            style={{ animationDelay: '600ms', animationFillMode: 'forwards' }}
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
