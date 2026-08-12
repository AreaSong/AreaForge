import React from 'react';

export const DataMatrix = ({ colorClass, textClass }: { colorClass: string, textClass: string }) => {
  return (
    <div className="w-full h-full relative flex items-end justify-center px-12 pb-12">
      <div className="flex gap-4 xl:gap-8 items-end h-[70%] w-full max-w-5xl">
        {[...Array(16)].map((_, barIdx) => (
          <div key={barIdx} className="flex-1 relative flex flex-col justify-end items-center h-full">
            <div className={`w-3 h-3 rounded-sm mb-3 bg-current ${textClass} opacity-0 animate-[fade-in-up_0.5s_ease-out_forwards]`} style={{ animationDelay: `${barIdx * 0.1 + 0.5}s` }}></div>
            <div 
              className={`w-full bg-gradient-to-t ${colorClass} opacity-60 rounded-t-md shadow-[0_0_20px_currentColor] animate-pulse transition-all duration-1000`}
              style={{ height: `${30 + (barIdx * 13) % 70}%`, animationDelay: `${barIdx * 0.15}s` }}
            ></div>
          </div>
        ))}
      </div>
    </div>
  );
};
