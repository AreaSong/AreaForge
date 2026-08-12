import React from 'react';

export const NeuralPulse = ({ colorClass, textClass }: { colorClass: string, textClass: string }) => {
  return (
    <div className="w-full h-[60%] relative flex items-center max-w-4xl">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_80%,transparent_100%)]"></div>
      <svg viewBox="0 0 800 200" className="w-full h-full drop-shadow-[0_0_20px_currentColor] z-10">
        <polyline points="0,100 250,100 280,40 330,170 380,100 800,100" fill="none" stroke="currentColor" strokeWidth="4" className={`${textClass} opacity-80`} strokeDasharray="800" strokeDashoffset="800">
          <animate attributeName="stroke-dashoffset" values="800;0" dur="2s" repeatCount="indefinite" />
        </polyline>
        <circle r="6" fill="white" className="drop-shadow-[0_0_15px_white]">
          <animateMotion dur="2s" repeatCount="indefinite" path="M 0 100 L 250 100 L 280 40 L 330 170 L 380 100 L 800 100" />
        </circle>
      </svg>
      <div className={`absolute bottom-4 right-10 font-black text-6xl md:text-8xl font-mono ${textClass} opacity-10 drop-shadow-xl animate-pulse`}>45:00</div>
    </div>
  );
};
