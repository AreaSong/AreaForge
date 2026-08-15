"use client";

import React, { useEffect, useState } from "react";
import { LEARNING_LOOP_NODES } from "../constants/learning-loop";
import { InteractiveArtCanvas } from "./interactive-art-canvas";

export interface AmbientBackgroundProps {
  activeStageIndex?: number;
  activeNodeIndex?: number;
  localProgress?: number;
  reducedMotion?: boolean;
  isLoginFocused?: boolean;
  className?: string;
}

export const AmbientBackground: React.FC<AmbientBackgroundProps> = ({
  activeStageIndex,
  activeNodeIndex,
  localProgress = 0,
  reducedMotion = false,
  isLoginFocused = false,
  className = "",
}) => {
  const currentStageIndex = activeStageIndex ?? activeNodeIndex ?? 0;
  const activeNode = LEARNING_LOOP_NODES[currentStageIndex] || LEARNING_LOOP_NODES[0];
  const [mousePos, setMousePos] = useState({ x: 50, y: 30 });

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const x = (e.clientX / window.innerWidth) * 100;
      const y = (e.clientY / window.innerHeight) * 100;
      setMousePos({ x, y });
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, []);

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 z-0 pointer-events-none overflow-hidden select-none ${className}`}
    >
      {/* 1. Deep Obsidian Cosmic Canvas Base */}
      <div className="absolute inset-0 bg-[#090a0d]" />

      {/* 2. Interactive Kinetic Volumetric Light Follower */}
      <div
        className="absolute h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[140px] transition-all duration-1000 ease-out opacity-20"
        style={{
          left: `${mousePos.x}%`,
          top: `${mousePos.y}%`,
          backgroundColor: activeNode.accent,
        }}
      />

      {/* 3. Stage-Bound Multi-Layer Ambient Auras */}
      <div
        className="absolute inset-0 transition-opacity duration-1000 ease-out"
        style={{ opacity: isLoginFocused ? 0.35 : 0.85 }}
      >
        {/* Primary Stage Light Cone (Top Left) */}
        <div
          className="absolute -top-[20%] -left-[10%] h-[850px] w-[850px] rounded-full blur-[120px] transition-colors duration-1000 ease-out"
          style={{
            background: `radial-gradient(circle, rgba(${activeNode.accentRgb}, 0.16) 0%, rgba(${activeNode.accentRgb}, 0.03) 55%, transparent 75%)`,
          }}
        />

        {/* Secondary Counter-Glow (Bottom Right) */}
        <div
          className="absolute -bottom-[20%] -right-[10%] h-[700px] w-[700px] rounded-full blur-[110px] transition-all duration-1000 ease-out"
          style={{
            background: `radial-gradient(circle, rgba(129, 140, 248, 0.08) 0%, rgba(45, 212, 191, 0.03) 50%, transparent 70%)`,
          }}
        />

        {/* Center Ground Axis Glow */}
        <div
          className="absolute top-[40%] left-[30%] h-[500px] w-[500px] rounded-full blur-[100px] transition-all duration-1000 ease-out"
          style={{
            background: `radial-gradient(circle, rgba(192, 132, 252, 0.05) 0%, transparent 60%)`,
          }}
        />
      </div>

      {/* 4. Interactive Gravitational Particle & Physics Canvas */}
      <InteractiveArtCanvas
        activeStageIndex={currentStageIndex}
        localProgress={localProgress}
        reducedMotion={reducedMotion}
      />

      {/* 5. Fine-Mesh Laser Coordinate Matrix Background Grid */}
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.035]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="af-matrix-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path
              d="M 48 0 L 0 0 0 48"
              fill="none"
              stroke="rgba(255, 255, 255, 0.6)"
              strokeWidth="0.8"
            />
            <circle cx="48" cy="48" r="1" fill="rgba(255, 255, 255, 0.4)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#af-matrix-grid)" />
      </svg>

      {/* 6. Analog Film Grain Texture Overlay */}
      <div
        className="absolute inset-0 mix-blend-overlay opacity-[0.025]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  );
};
