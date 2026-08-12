import React from 'react';

export const RadarEngine = ({ lineClass, textClass }: { lineClass: string, textClass: string }) => {
  return (
    <div className="w-[450px] h-[450px] relative flex items-center justify-center">
      <div className="absolute inset-0 rounded-full border-[1.5px] border-white/10"></div>
      <div className="absolute inset-10 rounded-full border-[1.5px] border-white/5"></div>
      <div className="absolute inset-20 rounded-full border-[1.5px] border-white/5"></div>
      <div className={`absolute inset-0 rounded-full bg-gradient-to-r from-transparent via-transparent to-current ${textClass} opacity-30 animate-[spin_2.5s_linear_infinite]`}></div>
      <div className={`absolute top-0 bottom-1/2 left-1/2 w-[3px] -translate-x-1/2 bg-current ${textClass} origin-bottom animate-[spin_2.5s_linear_infinite] drop-shadow-[0_0_25px_currentColor]`}></div>
      <div className="w-16 h-16 rounded-full bg-black border-4 border-white/20 flex items-center justify-center shadow-[0_0_40px_rgba(255,255,255,0.2)] z-10 relative">
        <div className={`w-6 h-6 rounded-full ${lineClass} animate-ping absolute`}></div>
        <div className={`w-3 h-3 rounded-full ${lineClass} z-20`}></div>
      </div>
      <div className="absolute top-[30%] right-[30%] w-8 h-8 border border-red-500/50 flex items-center justify-center group-hover:border-red-500 transition-colors animate-[ping_4s_ease-out_infinite]">
         <div className="w-1 h-1 bg-red-500"></div>
      </div>
    </div>
  );
};
