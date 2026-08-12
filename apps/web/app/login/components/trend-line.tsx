import React from 'react';

export const TrendLine = ({ textClass }: { textClass: string }) => {
  return (
    <div className="w-full h-full relative flex items-center justify-center p-12 max-w-5xl mx-auto">
       <svg viewBox="0 0 100 50" className="w-full h-full drop-shadow-[0_0_20px_currentColor] overflow-visible">
          <g className="opacity-10" stroke="white" strokeWidth="0.1">
             <line x1="0" y1="10" x2="100" y2="10" />
             <line x1="0" y1="25" x2="100" y2="25" />
             <line x1="0" y1="40" x2="100" y2="40" />
          </g>
          <path d="M 0 50 L 0 45 Q 15 40 25 25 T 45 30 T 65 15 T 85 20 T 100 5 L 100 50 Z" fill={`currentColor`} className={`${textClass} opacity-10`} />
          <path d="M 0 45 Q 15 40 25 25 T 45 30 T 65 15 T 85 20 T 100 5" fill="none" stroke="currentColor" strokeWidth="1" className={`${textClass} opacity-90`} strokeDasharray="300" strokeDashoffset="300">
             <animate attributeName="stroke-dashoffset" values="300;0" dur="2.5s" fill="freeze" />
          </path>
          <circle cx="25" cy="25" r="1.5" className={`fill-current ${textClass} animate-ping`} />
          <circle cx="65" cy="15" r="1.5" className={`fill-current ${textClass} animate-ping`} style={{ animationDelay: '0.5s'}} />
          <circle cx="100" cy="5" r="1.5" className={`fill-current ${textClass} animate-ping`} style={{ animationDelay: '1s'}} />
       </svg>
    </div>
  );
};
