"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { LoginForm } from "@/components/login-form";

// Constants
import { LEARNING_LOOP_NODES } from "./constants/learning-loop";

// New Refactored Components
import { ShowcaseStage } from "./components/showcase-stage";
import { JourneyTimeline } from "./components/journey-timeline";
import { AmbientBackground } from "./components/ambient-background";

// Original Background Components
import { NeuralPulse } from "./components/neural-pulse";
import { RadarEngine } from "./components/radar-engine";
import { DataMatrix } from "./components/data-matrix";
import { SystemNetwork } from "./components/system-network";
import { TrendLine } from "./components/trend-line";

export function LoginClient({ returnTo }: { returnTo: string }) {
  const [activeNodeIndex, setActiveNodeIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [isActiveContext, setIsActiveContext] = useState(false);
  const isLoginFocused = isHovered || isActiveContext;
  const rightPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleDocumentMouseDown = (e: MouseEvent) => {
      const rp = rightPanelRef.current;
      const isInside = rp?.contains(e.target as Node);
      if (!isInside) {
        setIsActiveContext(false);
      }
    };
    
    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
    };
  }, []);

  const handlePanelMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'INPUT' && target.tagName !== 'BUTTON' && target.tagName !== 'A' && !target.closest('button') && !target.closest('a')) {
      e.preventDefault();
    }
  };

  return (
    <main className="relative flex min-h-screen w-full bg-[#05080A] text-zinc-100 selection:bg-teal-500/30 overflow-hidden">
      
      {/* 真正的全屏沉浸式动效背景 */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden flex items-center justify-center">
        {LEARNING_LOOP_NODES.map((node, index) => {
          const isActive = index === activeNodeIndex;
          if (node.id === 'overview') return null; // 首页不要全屏花哨特效
          return (
            <div 
              key={node.id} 
              className={`absolute inset-0 transition-all duration-[1200ms] ease-[cubic-bezier(0.16,1,0.3,1)] flex items-center justify-center ${isActive ? 'opacity-100 scale-100 z-10' : 'opacity-0 scale-105 z-0'}`}
            >
              {node.id === 'focus' && <NeuralPulse colorClass={node.colorClass} textClass={node.textClass} />}
              {node.id === 'plan' && <RadarEngine lineClass={node.lineClass} textClass={node.textClass} />}
              {node.id === 'retest' && <DataMatrix colorClass={node.colorClass} textClass={node.textClass} />}
              {node.id === 'closeout' && <SystemNetwork textClass={node.textClass} />}
              {node.id === 'adjust' && <TrendLine textClass={node.textClass} />}
              
              {/* 超巨型标题水印底纹 */}
              <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[15vw] font-black tracking-tighter whitespace-nowrap opacity-[0.03] ${node.textClass} mix-blend-overlay`}>
                {node.id.toUpperCase()}
              </div>
            </div>
          );
        })}
      </div>
      
      <AmbientBackground activeNodeIndex={activeNodeIndex} isLoginFocused={isLoginFocused} />

      {/* 主体容器 (重构布局比例为 7:3 / 6.5:3.5) */}
      <div className="relative z-10 mx-auto w-full max-w-[2400px] grid grid-cols-1 lg:grid-cols-[1fr_480px] xl:grid-cols-[1fr_540px] items-center px-6 md:px-12 xl:px-24 min-h-screen gap-8 lg:gap-12">
        
        {/* ================= 左侧：学习闭环交互画卷 ================= */}
        <div 
          className={`flex h-full w-full flex-col justify-between py-12 transition-all duration-700 ease-in-out ${isLoginFocused ? 'opacity-40 scale-[0.98] -translate-x-4' : 'opacity-100 scale-100 translate-x-0'}`}
        >
          {/* Header 品牌 */}
          <div className="mb-12 flex items-center gap-6 opacity-0 animate-slide-up-fade" style={{ animationDelay: '0ms', animationFillMode: 'forwards' }}>
            <Image src="/brand/areaforge-logo-lockup.svg" alt="AreaForge Logo" width={300} height={98} className="h-12 md:h-16 w-auto object-contain drop-shadow-lg opacity-90 hover:opacity-100 transition-opacity" priority />
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-400 backdrop-blur-md shadow-sm">
              <span className={`h-2 w-2 rounded-full transition-colors duration-700 shadow-[0_0_8px_currentColor] ${LEARNING_LOOP_NODES[activeNodeIndex].lineClass}`}></span>
              v1.1.2 Production
            </div>
          </div>

          {/* ================= 聚光灯舞台与卡片网格重构区域 ================= */}
          <div className="relative flex-1 w-full min-h-[500px] flex flex-col pt-4">
            {LEARNING_LOOP_NODES.map((node, index) => {
              const isActive = index === activeNodeIndex;
              return (
                <div 
                  key={node.id}
                  className={`absolute inset-0 flex flex-col justify-between transition-all duration-[800ms] cubic-bezier(0.16, 1, 0.3, 1) ${isActive ? 'opacity-100 translate-x-0 z-10 pointer-events-auto' : 'opacity-0 -translate-x-8 z-0 pointer-events-none'}`}
                >
                  <div className="flex-1 w-full relative overflow-visible">
                    <div className={`absolute inset-0 bg-gradient-to-br ${node.colorClass} opacity-[0.02] mix-blend-screen`}></div>
                    <ShowcaseStage node={node} isActive={isActive} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* 底部线路图 */}
          <JourneyTimeline activeNodeIndex={activeNodeIndex} setActiveNodeIndex={setActiveNodeIndex} />
        </div>

        {/* ================= 右侧表单区 (Focus Mode Trigger) ================= */}
        <div 
          ref={rightPanelRef}
          className="flex w-full shrink-0 justify-center opacity-0 animate-fade-in-up outline-none" 
          style={{ animationDelay: '500ms', animationFillMode: 'forwards' }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onMouseDownCapture={() => setIsActiveContext(true)}
          onMouseDown={handlePanelMouseDown}
        >
          <div className="relative w-full group max-w-[460px]">
            {/* 炫酷底座光晕 (联动当前激活节点的颜色) */}
            <div className={`absolute -inset-1 z-0 rounded-[2.5rem] transition-all duration-700 ease-out bg-gradient-to-b ${LEARNING_LOOP_NODES[activeNodeIndex].colorClass} ${isLoginFocused ? 'opacity-20 scale-[1.02] blur-xl' : 'opacity-10 scale-95 blur-lg'}`}></div>
            
            {/* 悬浮玻璃面板 */}
            <div className={`relative z-10 w-full overflow-hidden rounded-[2.5rem] border p-8 sm:p-10 backdrop-blur-2xl transition-all duration-700 ease-out ${isLoginFocused ? `border-white/20 shadow-[0_0_80px_rgba(0,0,0,0.6)] bg-[#05080A]/90 translate-y-0 scale-100` : 'border-white/10 shadow-[0_8px_40px_rgba(0,0,0,0.5)] bg-[#05080A]/60 translate-y-2 scale-[0.98]'}`}>
              
              <div className={`login-form-container transition-all duration-700 ${isLoginFocused ? 'opacity-100' : 'opacity-90'}`}>
                <LoginForm returnTo={returnTo} />
              </div>
              
              {/* 当未聚焦时，显示一个微微发光的遮罩提示交互 */}
              {!isLoginFocused && (
                <div className="absolute inset-0 z-20 hidden lg:flex items-center justify-center pointer-events-none rounded-[2.5rem] border border-white/5 bg-black/20 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 transition-opacity duration-300">
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
