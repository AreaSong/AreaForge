"use client";

import React from "react";
import { LEARNING_LOOP_NODES } from "../constants/learning-loop";

interface AmbientBackgroundProps {
  activeNodeIndex: number;
  isLoginFocused?: boolean;
}

export const AmbientBackground: React.FC<AmbientBackgroundProps> = ({
  activeNodeIndex,
  isLoginFocused = false,
}) => {
  const activeNode = LEARNING_LOOP_NODES[activeNodeIndex] || LEARNING_LOOP_NODES[0];

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-0 pointer-events-none overflow-hidden select-none"
    >
      {/* 1. Deep Graphite Workspace Canvas Base */}
      <div className="absolute inset-0 bg-[#121316]" />

      {/* 2. Hardware-Optimized Dynamic Atmospheric Ambient Glow */}
      <div
        className="absolute inset-0 transition-opacity duration-700 ease-out"
        style={{ opacity: isLoginFocused ? 0.35 : 0.75 }}
      >
        {/* Primary Stage Ambient Glow (Top Left) */}
        <div
          className="absolute -top-[15%] -left-[10%] h-[750px] w-[750px] rounded-full blur-[100px] transition-colors duration-700 ease-out"
          style={{
            background: `radial-gradient(circle, rgba(${activeNode.accentRgb}, 0.12) 0%, rgba(${activeNode.accentRgb}, 0.02) 55%, transparent 70%)`,
          }}
        />

        {/* Secondary Warm Counter-Glow (Bottom Center) */}
        <div
          className="absolute -bottom-[20%] left-[20%] h-[600px] w-[600px] rounded-full blur-[90px] transition-all duration-700 ease-out"
          style={{
            background: `radial-gradient(circle, rgba(45, 212, 191, 0.06) 0%, rgba(96, 165, 250, 0.02) 50%, transparent 70%)`,
          }}
        />

        {/* Tertiary Subtle Console Glow (Right Edge) */}
        <div
          className="absolute top-[20%] -right-[10%] h-[550px] w-[550px] rounded-full blur-[80px] transition-all duration-700 ease-out"
          style={{
            background: `radial-gradient(circle, rgba(192, 132, 252, 0.05) 0%, rgba(56, 189, 248, 0.02) 50%, transparent 70%)`,
          }}
        />
      </div>

      {/* 3. Subtle Atmospheric Noise Texture Overlay */}
      <div
        className="absolute inset-0 mix-blend-overlay opacity-[0.02]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  );
};
