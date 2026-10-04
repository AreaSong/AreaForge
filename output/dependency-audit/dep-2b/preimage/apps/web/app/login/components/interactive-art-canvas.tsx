"use client";

import React, { useEffect, useRef } from "react";

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export interface InteractiveArtCanvasProps {
  activeStageIndex: number;
  localProgress: number;
  reducedMotion: boolean;
  className?: string;
}

export interface Particle {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  vx: number;
  vy: number;
  radius: number;
  baseAlpha: number;
  phase: number;
  pulseSpeed: number;
  orbitRadius: number;
  orbitSpeed: number;
}

export const STAGE_PALETTES: readonly RGBColor[] = [
  { r: 96, g: 165, b: 250 },  // Stage 1 Blue (#60a5fa)
  { r: 45, g: 212, b: 191 },  // Stage 2 Teal (#2dd4bf)
  { r: 251, g: 191, b: 36 },  // Stage 3 Amber (#fbbf24)
  { r: 56, g: 189, b: 248 },  // Stage 4 Sky (#38bdf8)
  { r: 52, g: 211, b: 153 },  // Stage 5 Emerald (#34d399)
  { r: 192, g: 132, b: 252 }, // Stage 6 Purple (#c084fc)
];

export const PHYSICS_CONSTANTS = {
  SPRING_K: 0.042,
  DAMPING: 0.89,
  INFLUENCE_RADIUS: 180,
  GRAVITY_STRENGTH: 5.2,
  MAX_VELOCITY: 12.0,
  PROXIMITY_THRESHOLD: 65,
  DPR_CAP: 2.0,
} as const;

const DEFAULT_STAGE_COLOR: RGBColor = { r: 96, g: 165, b: 250 };

export function getInterpolatedStageColor(
  activeStageIndex: number,
  localProgress: number
): RGBColor {
  const stageCount = STAGE_PALETTES.length;
  if (stageCount === 0) return DEFAULT_STAGE_COLOR;

  const safeStage = Number.isFinite(activeStageIndex)
    ? Math.max(0, Math.min(Math.floor(activeStageIndex), stageCount - 1))
    : 0;
  const nextStage = (safeStage + 1) % stageCount;
  const t = Number.isFinite(localProgress) ? Math.max(0, Math.min(localProgress, 1)) : 0;

  const current = STAGE_PALETTES[safeStage] ?? STAGE_PALETTES[0] ?? DEFAULT_STAGE_COLOR;
  const next = STAGE_PALETTES[nextStage] ?? STAGE_PALETTES[0] ?? DEFAULT_STAGE_COLOR;

  return {
    r: Math.round(current.r + (next.r - current.r) * t),
    g: Math.round(current.g + (next.g - current.g) * t),
    b: Math.round(current.b + (next.b - current.b) * t),
  };
}

export function createParticlesForBounds(width: number, height: number): Particle[] {
  const particles: Particle[] = [];
  if (width <= 0 || height <= 0) return particles;

  let spacing = 88;
  if (width < 640) {
    spacing = 105;
  } else if (width < 1024) {
    spacing = 96;
  } else if (width > 1920) {
    spacing = 80;
  }

  const cols = Math.ceil(width / spacing) + 1;
  const rows = Math.ceil(height / (spacing * 0.866)) + 1;

  let seed = 1337;
  const seededRandom = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let r = 0; r < rows; r++) {
    const rowOffset = (r % 2 === 1 ? spacing * 0.5 : 0);
    for (let c = 0; c < cols; c++) {
      const jitterX = (seededRandom() - 0.5) * spacing * 0.45;
      const jitterY = (seededRandom() - 0.5) * spacing * 0.45;
      const homeX = c * spacing + rowOffset + jitterX;
      const homeY = r * (spacing * 0.866) + jitterY;

      if (homeX >= -spacing * 0.5 && homeX <= width + spacing * 0.5 &&
          homeY >= -spacing * 0.5 && homeY <= height + spacing * 0.5) {
        const radius = 1.2 + seededRandom() * 1.6;
        const baseAlpha = 0.3 + seededRandom() * 0.45;
        const phase = seededRandom() * Math.PI * 2;
        const pulseSpeed = 0.8 + seededRandom() * 1.2;
        const orbitRadius = 1.2 + seededRandom() * 2.8;
        const orbitSpeed = 0.4 + seededRandom() * 0.7;

        particles.push({
          x: homeX,
          y: homeY,
          homeX,
          homeY,
          vx: 0,
          vy: 0,
          radius,
          baseAlpha,
          phase,
          pulseSpeed,
          orbitRadius,
          orbitSpeed,
        });
      }
    }
  }

  return particles;
}

export function drawConstellationFrame(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  width: number,
  height: number,
  color: RGBColor,
  pointer: { x: number; y: number; active: boolean } | null,
  timeSeconds: number,
  isStatic: boolean
): void {
  ctx.clearRect(0, 0, width, height);

  const proximitySq = PHYSICS_CONSTANTS.PROXIMITY_THRESHOLD * PHYSICS_CONSTANTS.PROXIMITY_THRESHOLD;
  const count = particles.length;

  ctx.lineWidth = 0.75;
  for (let i = 0; i < count; i++) {
    const p1 = particles[i]!;
    for (let j = i + 1; j < count; j++) {
      const p2 = particles[j]!;
      const dx = p1.x - p2.x;
      const dy = p1.y - p2.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < proximitySq) {
        const dist = Math.sqrt(distSq);
        const alphaFactor = (1 - dist / PHYSICS_CONSTANTS.PROXIMITY_THRESHOLD);
        const lineAlpha = alphaFactor * 0.22;

        ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${lineAlpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }
  }

  if (pointer && pointer.active && !isStatic) {
    const pointerInfluenceSq = 140 * 140;
    for (let i = 0; i < count; i++) {
      const p = particles[i]!;
      const dx = p.x - pointer.x;
      const dy = p.y - pointer.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < pointerInfluenceSq) {
        const dist = Math.sqrt(distSq);
        const alpha = (1 - dist / 140) * 0.35;
        ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(pointer.x, pointer.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }
  }

  for (let i = 0; i < count; i++) {
    const p = particles[i]!;
    const pulse = isStatic
      ? 1.0
      : 0.8 + 0.2 * Math.sin(timeSeconds * p.pulseSpeed + p.phase);
    const alpha = Math.min(1, Math.max(0, p.baseAlpha * pulse));

    if (p.radius > 1.8) {
      ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${(alpha * 0.2).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();

    if (!isStatic && Math.hypot(p.vx, p.vy) > 0.8) {
      ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${(alpha * 0.4).toFixed(3)})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 1.5, p.y - p.vy * 1.5);
      ctx.stroke();
    }
  }
}

export function updateParticlePhysics(
  particles: Particle[],
  pointer: { x: number; y: number; active: boolean } | null,
  timeSeconds: number
): void {
  const { SPRING_K, DAMPING, INFLUENCE_RADIUS, GRAVITY_STRENGTH, MAX_VELOCITY } = PHYSICS_CONSTANTS;
  const influenceSq = INFLUENCE_RADIUS * INFLUENCE_RADIUS;

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]!;

    const ambientX = Math.cos(timeSeconds * p.orbitSpeed + p.phase) * p.orbitRadius;
    const ambientY = Math.sin(timeSeconds * p.orbitSpeed + p.phase) * p.orbitRadius;
    const targetX = p.homeX + ambientX;
    const targetY = p.homeY + ambientY;

    const springX = (targetX - p.x) * SPRING_K;
    const springY = (targetY - p.y) * SPRING_K;

    let gravX = 0;
    let gravY = 0;

    if (pointer && pointer.active) {
      const dx = p.x - pointer.x;
      const dy = p.y - pointer.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < influenceSq && distSq > 0.04) {
        const dist = Math.sqrt(distSq);
        const norm = 1 - dist / INFLUENCE_RADIUS;
        const force = GRAVITY_STRENGTH * norm * norm;
        gravX = (dx / dist) * force;
        gravY = (dy / dist) * force;
      }
    }

    p.vx = (p.vx + springX + gravX) * DAMPING;
    p.vy = (p.vy + springY + gravY) * DAMPING;

    const speed = Math.hypot(p.vx, p.vy);
    if (speed > MAX_VELOCITY) {
      p.vx = (p.vx / speed) * MAX_VELOCITY;
      p.vy = (p.vy / speed) * MAX_VELOCITY;
    }

    p.x += p.vx;
    p.y += p.vy;
  }
}

export const InteractiveArtCanvas: React.FC<InteractiveArtCanvasProps> = ({
  activeStageIndex,
  localProgress,
  reducedMotion,
  className = "",
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const pointerRef = useRef<{ x: number; y: number; active: boolean }>({
    x: -9999,
    y: -9999,
    active: false,
  });
  const stageStateRef = useRef({ activeStageIndex, localProgress, reducedMotion });

  useEffect(() => {
    stageStateRef.current = { activeStageIndex, localProgress, reducedMotion };
    if (reducedMotion && canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        const rect = canvasRef.current.getBoundingClientRect();
        const color = getInterpolatedStageColor(activeStageIndex, localProgress);
        drawConstellationFrame(ctx, particlesRef.current, rect.width, rect.height, color, null, 0, true);
      }
    }
  }, [activeStageIndex, localProgress, reducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number | null = null;
    let width = 0;
    let height = 0;
    let isTabVisible = !document.hidden;

    const resizeCanvas = () => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, PHYSICS_CONSTANTS.DPR_CAP);

      width = rect.width;
      height = rect.height;

      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particlesRef.current = createParticlesForBounds(width, height);

      if (stageStateRef.current.reducedMotion) {
        const color = getInterpolatedStageColor(
          stageStateRef.current.activeStageIndex,
          stageStateRef.current.localProgress
        );
        drawConstellationFrame(ctx, particlesRef.current, width, height, color, null, 0, true);
      }
    };

    resizeCanvas();

    const handleResize = () => {
      resizeCanvas();
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        active: true,
      };
    };

    const handlePointerLeave = () => {
      pointerRef.current.active = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!canvas || e.touches.length === 0) return;
      const touch = e.touches[0]!;
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
        active: true,
      };
    };

    const handleTouchEnd = () => {
      pointerRef.current.active = false;
    };

    const handleVisibilityChange = () => {
      isTabVisible = !document.hidden;
      if (!isTabVisible && animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      } else if (isTabVisible && !stageStateRef.current.reducedMotion && animationFrameId === null) {
        startAnimationLoop();
      }
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerleave", handlePointerLeave);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("touchcancel", handleTouchEnd);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const startAnimationLoop = () => {
      if (stageStateRef.current.reducedMotion) {
        const color = getInterpolatedStageColor(
          stageStateRef.current.activeStageIndex,
          stageStateRef.current.localProgress
        );
        drawConstellationFrame(ctx, particlesRef.current, width, height, color, null, 0, true);
        return;
      }

      const startTime = performance.now();

      const render = (now: number) => {
        if (stageStateRef.current.reducedMotion) {
          const color = getInterpolatedStageColor(
            stageStateRef.current.activeStageIndex,
            stageStateRef.current.localProgress
          );
          drawConstellationFrame(ctx, particlesRef.current, width, height, color, null, 0, true);
          animationFrameId = null;
          return;
        }

        if (!isTabVisible) {
          animationFrameId = null;
          return;
        }

        const elapsedSeconds = (now - startTime) * 0.001;
        const color = getInterpolatedStageColor(
          stageStateRef.current.activeStageIndex,
          stageStateRef.current.localProgress
        );

        updateParticlePhysics(particlesRef.current, pointerRef.current, elapsedSeconds);
        drawConstellationFrame(
          ctx,
          particlesRef.current,
          width,
          height,
          color,
          pointerRef.current,
          elapsedSeconds,
          false
        );

        animationFrameId = requestAnimationFrame(render);
      };

      animationFrameId = requestAnimationFrame(render);
    };

    if (!reducedMotion) {
      startAnimationLoop();
    } else {
      const color = getInterpolatedStageColor(activeStageIndex, localProgress);
      drawConstellationFrame(ctx, particlesRef.current, width, height, color, null, 0, true);
    }

    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`absolute inset-0 h-full w-full pointer-events-none ${className}`}
    />
  );
};
