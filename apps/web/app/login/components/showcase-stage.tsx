import React from "react";
import { LearningLoopNode } from "../constants/learning-loop";

export const ShowcaseStage = ({ node, isActive }: { node: LearningLoopNode, isActive: boolean }) => {
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
    </div>
  );
};
