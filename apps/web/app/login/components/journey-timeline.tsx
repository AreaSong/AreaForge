import React from "react";
import { LEARNING_LOOP_NODES } from "../constants/learning-loop";

interface JourneyTimelineProps {
  activeNodeIndex: number;
  setActiveNodeIndex: (index: number) => void;
}

export const JourneyTimeline: React.FC<JourneyTimelineProps> = ({ activeNodeIndex, setActiveNodeIndex }) => {
  return (
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
  );
};
