import React from 'react';

export const SystemNetwork = ({ textClass }: { textClass: string }) => {
  return (
    <div className="w-full h-full relative flex items-center justify-center p-12 max-w-5xl mx-auto">
      <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible">
        <circle cx="10" cy="50" r="2" className={`fill-current ${textClass} animate-pulse`} />
        <circle cx="30" cy="20" r="1.5" className={`fill-current ${textClass}`} />
        <circle cx="30" cy="80" r="1.5" className={`fill-current ${textClass}`} />
        <circle cx="60" cy="30" r="3" className={`fill-current ${textClass} animate-pulse`} />
        <circle cx="60" cy="70" r="2" className={`fill-current ${textClass}`} />
        <circle cx="90" cy="50" r="4" className={`fill-current ${textClass} shadow-xl`} />
        
        <g fill="none" stroke="currentColor" className={`${textClass} opacity-30`} strokeWidth="0.3">
           <path d="M10,50 L30,20 L60,30 L90,50 L60,70 L30,80 Z" strokeDasharray="300" strokeDashoffset="300">
              <animate attributeName="stroke-dashoffset" values="300;0" dur="2.5s" fill="freeze" />
           </path>
           <path d="M10,50 L30,80 M30,20 L60,70 M30,80 L60,30" strokeWidth="0.15" opacity="0.5" />
           <path d="M10,50 L90,50" strokeWidth="0.5" strokeDasharray="5 2" className="animate-[pulse_1s_infinite] opacity-80" />
        </g>
        
        <g fill="white" className="drop-shadow-[0_0_10px_white]">
          <circle r="1"><animateMotion dur="2s" repeatCount="indefinite" path="M10,50 L30,20 L60,30 L90,50" /></circle>
          <circle r="1"><animateMotion dur="2.5s" repeatCount="indefinite" path="M10,50 L30,80 L60,70 L90,50" /></circle>
          <circle r="1.5"><animateMotion dur="1.5s" repeatCount="indefinite" path="M10,50 L90,50" /></circle>
        </g>
      </svg>
    </div>
  );
};
