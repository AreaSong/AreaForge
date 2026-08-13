"use client";

import React, { useEffect, useRef, useState } from "react";
import { LEARNING_LOOP_NODES } from "../constants/learning-loop";

interface AmbientBackgroundProps {
  activeNodeIndex: number;
  isLoginFocused: boolean;
}

export const AmbientBackground: React.FC<AmbientBackgroundProps> = ({ activeNodeIndex, isLoginFocused }) => {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const requestRef = useRef<number>(0);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      requestRef.current = requestAnimationFrame(() => {
        // Normalize mouse pos from -1 to 1 based on screen size
        const x = (e.clientX / window.innerWidth) * 2 - 1;
        const y = (e.clientY / window.innerHeight) * 2 - 1;
        setMousePos({ x, y });
      });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  return (
    <>
      {/* 沉浸式全局环境光 (根据 activeNode 动态渐变) */}
      <div 
        className="absolute inset-0 z-0 pointer-events-none transition-opacity duration-1000" 
        style={{ opacity: isLoginFocused ? 0.4 : 1 }}
      >
        <div 
          className={`absolute -left-[10%] top-[-10%] h-[1000px] w-[1000px] rounded-full blur-[120px] transition-colors duration-1000 ease-in-out ${LEARNING_LOOP_NODES[activeNodeIndex].glowClass}`}
          style={{ transform: `translate(${mousePos.x * -20}px, ${mousePos.y * -20}px)` }}
        ></div>
        <div 
          className="absolute right-[-10%] bottom-[-10%] h-[800px] w-[800px] rounded-full bg-cyan-900/10 blur-[120px]"
          style={{ transform: `translate(${mousePos.x * 15}px, ${mousePos.y * 15}px)` }}
        ></div>
      </div>

      {/* 微米级噪点遮罩层 (Micro Noise Dithering) 彻底消除大面积渐变导致的 Color Banding (色带阶梯现象) */}
      {/* 优化性能：仅在需要时渲染，并降低不透明度 */}
      <div 
        className="absolute inset-0 z-0 pointer-events-none mix-blend-overlay opacity-[0.03]"
        style={{ 
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`
        }}
      ></div>
    </>
  );
};
