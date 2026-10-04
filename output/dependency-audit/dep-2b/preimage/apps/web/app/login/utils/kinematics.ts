/**
 * AreaForge Login Showcase Stage — Kinematics & Interpolation Engine
 * 
 * Mathematical primitives and stage-specific interpolators for timeline-driven
 * physics, 3D card flipping, elastic stamp landings, and SVG path drawing.
 * 
 * Zero external dependencies. Fully pure and numeric-hardened.
 */

// ==========================================
// 1. Data Types & Interfaces
// ==========================================

export interface Point2D {
  x: number;
  y: number;
}

export interface StampTransform {
  scale: number;
  opacity: number;
  rotateDeg: number;
  translateY: number;
}

export interface RayState {
  x: number;
  y: number;
  progress: number;
  opacity: number;
}

// Backward-compatible type aliases
export type StampLandingState = StampTransform;
export type LoopbackRayState = RayState;

// ==========================================
// 2. Core Mathematical Primitives
// ==========================================

/**
 * Clamps a number between min and max bounds.
 * Automatically handles inverted bounds (min > max), NaN, and +/- Infinity.
 */
export function clamp(val: number, min: number, max: number): number {
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? max : 0;
  const lower = Math.min(safeMin, safeMax);
  const upper = Math.max(safeMin, safeMax);

  if (Number.isNaN(val)) {
    return lower;
  }
  return Math.min(Math.max(val, lower), upper);
}

/**
 * Linear interpolation between start and end by factor t.
 * Robust against NaN / Infinity.
 */
export function lerp(start: number, end: number, t: number): number {
  if (!Number.isFinite(t)) return Number.isFinite(start) ? start : 0;
  if (!Number.isFinite(start)) return 0;
  if (!Number.isFinite(end)) return start;
  if (t <= 0) return start;
  if (t >= 1) return end;
  return start + (end - start) * t;
}

/**
 * Smooth Hermite cubic interpolation with zero 1st derivatives at boundaries.
 * Robust against min === max (division by zero) and inverted bounds.
 */
export function smoothstep(min: number, max: number, val: number): number {
  if (Number.isNaN(val)) return 0;
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? max : 0;
  if (Math.abs(safeMax - safeMin) < 1e-9) {
    return val >= safeMax ? 1 : 0;
  }
  const lower = Math.min(safeMin, safeMax);
  const upper = Math.max(safeMin, safeMax);
  if (val <= lower) return 0;
  if (val >= upper) return 1;
  const t = clamp((val - lower) / (upper - lower), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Maps progress in [0, 1] to sub-interval [start, end], normalized and clamped to [0, 1].
 */
export function segmentProgress(progress: number, start: number, end: number): number {
  if (Number.isNaN(progress)) return 0;
  const safeStart = Number.isFinite(start) ? start : 0;
  const safeEnd = Number.isFinite(end) ? end : 1;
  const length = safeEnd - safeStart;
  if (Math.abs(length) < 1e-9) {
    return progress >= safeStart ? 1 : 0;
  }
  if (progress <= safeStart) return 0;
  if (progress >= safeEnd) return 1;
  return clamp((progress - safeStart) / length, 0, 1);
}

/**
 * Penner easeOutBack easing with configurable overshoot constant c1.
 * Default c1 = 1.70158 (approx 10.4% physical overshoot).
 */
export function easeOutBack(x: number, c1: number = 1.70158): number {
  if (Number.isNaN(x)) return 0;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const safeC1 = Number.isFinite(c1) ? c1 : 1.70158;
  const t = clamp(x, 0, 1);
  const c3 = safeC1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + safeC1 * u * u;
}

/**
 * Symmetrical cubic ease-in-out polynomial curve with zero inflection boundary acceleration.
 */
export function easeInOutCubic(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const t = clamp(x, 0, 1);
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Analytical damped harmonic oscillator step response y(t) from rest to 1.
 * Defaults: damping = 12 (zeta = 0.447), stiffness = 180 (omega_0 = 13.416, omega_d = 12).
 */
export function springInterpolate(
  t: number,
  damping: number = 12,
  stiffness: number = 180
): number {
  if (Number.isNaN(t)) return 0;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const clampedT = clamp(t, 0, 1);
  if (clampedT <= 0) return 0;
  if (clampedT >= 1) return 1;

  const safeDamping = Number.isFinite(damping) ? damping : 12;
  const safeStiffness = Number.isFinite(stiffness) ? stiffness : 180;
  const gamma = Math.max(0, safeDamping) / 2;
  const omega0Sq = Math.max(1e-4, safeStiffness);
  const discriminant = omega0Sq - gamma * gamma;

  let yRaw: number;

  if (discriminant > 1e-6) {
    // Underdamped
    const omegaD = Math.sqrt(discriminant);
    const decay = Math.exp(-gamma * clampedT);
    yRaw = 1 - decay * (Math.cos(omegaD * clampedT) + (gamma / omegaD) * Math.sin(omegaD * clampedT));
  } else if (discriminant < -1e-6) {
    // Overdamped
    const beta = Math.sqrt(-discriminant);
    const decay = Math.exp(-gamma * clampedT);
    yRaw = 1 - decay * (Math.cosh(beta * clampedT) + (gamma / beta) * Math.sinh(beta * clampedT));
  } else {
    // Critically damped
    const decay = Math.exp(-gamma * clampedT);
    yRaw = 1 - decay * (1 + gamma * clampedT);
  }

  // Exact endpoint normalization factor
  const finalDecay = Math.exp(-gamma);
  let yFinal: number;
  if (discriminant > 1e-6) {
    const omegaD = Math.sqrt(discriminant);
    yFinal = 1 - finalDecay * (Math.cos(omegaD) + (gamma / omegaD) * Math.sin(omegaD));
  } else if (discriminant < -1e-6) {
    const beta = Math.sqrt(-discriminant);
    yFinal = 1 - finalDecay * (Math.cosh(beta) + (gamma / beta) * Math.sinh(beta));
  } else {
    yFinal = 1 - finalDecay * (1 + gamma);
  }

  if (Math.abs(yFinal) > 1e-4) {
    return clamp(yRaw / yFinal, 0, 1.25);
  }
  return clamp(yRaw, 0, 1.25);
}

// ==========================================
// 3. 2D Geometry & Bézier Primitives
// ==========================================

/**
 * Evaluates a point on a 2D cubic Bézier curve at parameter t in [0, 1].
 */
export function evaluateCubicBezier(
  t: number,
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D
): Point2D {
  const u = clamp(t, 0, 1);
  const u1 = 1 - u;
  const u1Sq = u1 * u1;
  const u1Cu = u1Sq * u1;
  const uSq = u * u;
  const uCu = uSq * u;

  const safeP0 = { x: Number.isFinite(p0?.x) ? p0.x : 0, y: Number.isFinite(p0?.y) ? p0.y : 0 };
  const safeP1 = { x: Number.isFinite(p1?.x) ? p1.x : 0, y: Number.isFinite(p1?.y) ? p1.y : 0 };
  const safeP2 = { x: Number.isFinite(p2?.x) ? p2.x : 0, y: Number.isFinite(p2?.y) ? p2.y : 0 };
  const safeP3 = { x: Number.isFinite(p3?.x) ? p3.x : 0, y: Number.isFinite(p3?.y) ? p3.y : 0 };

  return {
    x: u1Cu * safeP0.x + 3 * u1Sq * u * safeP1.x + 3 * u1 * uSq * safeP2.x + uCu * safeP3.x,
    y: u1Cu * safeP0.y + 3 * u1Sq * u * safeP1.y + 3 * u1 * uSq * safeP2.y + uCu * safeP3.y,
  };
}

// ==========================================
// 4. Piecewise Stage Progress Interpolators
// ==========================================

/**
 * Calculates SVG stroke dashoffset from path length over [start, end].
 */
export function interpolateStrokeDashoffset(
  stageProgress: number,
  pathLength: number,
  start: number = 0.05,
  end: number = 0.85
): number {
  if (!Number.isFinite(pathLength) || pathLength <= 0) return 0;
  const safeStart = Number.isFinite(start) ? start : 0.05;
  const safeEnd = Number.isFinite(end) ? end : 0.85;
  const t = segmentProgress(stageProgress, safeStart, safeEnd);
  const eased = easeInOutCubic(t);
  return pathLength * (1 - eased);
}

/**
 * Calculates 3D Card rotation in degrees around Y-axis.
 */
export function interpolateCardRotateY(
  stageProgress: number,
  startAngle: number = 0,
  endAngle: number = 180,
  start: number = 0.2,
  end: number = 0.75
): number {
  const safeStartAngle = Number.isFinite(startAngle) ? startAngle : 0;
  const safeEndAngle = Number.isFinite(endAngle) ? endAngle : 180;
  const safeStart = Number.isFinite(start) ? start : 0.2;
  const safeEnd = Number.isFinite(end) ? end : 0.75;
  const t = segmentProgress(stageProgress, safeStart, safeEnd);
  const eased = easeInOutCubic(t);
  return lerp(safeStartAngle, safeEndAngle, eased);
}

/**
 * Calculates animated numeric counter value.
 */
export function interpolateCounterValue(
  stageProgress: number,
  targetVal: number,
  initialVal: number = 0,
  start: number = 0.1,
  end: number = 0.8
): number {
  const safeInitial = Number.isFinite(initialVal) ? initialVal : 0;
  const safeTarget = Number.isFinite(targetVal) ? targetVal : safeInitial;
  const safeStart = Number.isFinite(start) ? start : 0.1;
  const safeEnd = Number.isFinite(end) ? end : 0.8;
  const t = segmentProgress(stageProgress, safeStart, safeEnd);
  const eased = easeInOutCubic(t);
  return lerp(safeInitial, safeTarget, eased);
}

/**
 * Calculates scalar scale factor for stamp landing with overshoot.
 */
export function interpolateStampLanding(
  stageProgress: number,
  start: number = 0.65,
  end: number = 0.85
): number {
  const safeStart = Number.isFinite(start) ? start : 0.65;
  const safeEnd = Number.isFinite(end) ? end : 0.85;
  if (!Number.isFinite(stageProgress) || stageProgress < safeStart) return 0;
  const t = segmentProgress(stageProgress, safeStart, safeEnd);
  const eased = easeOutBack(t, 1.70158);
  return lerp(2.2, 1.0, eased);
}

/**
 * Generates full physical transform descriptor for rubber stamp imprints.
 */
export function getStampTransform(
  stageProgress: number,
  start: number = 0.65,
  end: number = 0.85
): StampTransform {
  const safeStart = Number.isFinite(start) ? start : 0.65;
  const safeEnd = Number.isFinite(end) ? end : 0.85;
  if (!Number.isFinite(stageProgress) || stageProgress < safeStart) {
    return { scale: 0, opacity: 0, rotateDeg: -18, translateY: -20 };
  }
  const t = segmentProgress(stageProgress, safeStart, safeEnd);
  const eased = easeOutBack(t, 1.70158);
  return {
    scale: lerp(2.2, 1.0, eased),
    opacity: clamp(t * 3.0, 0, 1),
    rotateDeg: lerp(-18, -6, eased),
    translateY: lerp(-20, 0, eased),
  };
}

/**
 * Normalized parameter [0, 1] for Stage 6 -> Stage 1 loopback ray.
 */
export function interpolateLoopbackRay(
  stageProgress: number,
  start: number = 0.70,
  end: number = 0.98
): number {
  const safeStart = Number.isFinite(start) ? start : 0.70;
  const safeEnd = Number.isFinite(end) ? end : 0.98;
  const t = segmentProgress(stageProgress, safeStart, safeEnd);
  return easeInOutCubic(t);
}

/**
 * Evaluates real-time 2D position and glow opacity for loopback ray.
 */
export function getLoopbackRayPosition(
  stageProgress: number,
  p0: Point2D = { x: 85, y: 75 },
  p1: Point2D = { x: 95, y: 95 },
  p2: Point2D = { x: 10, y: 95 },
  p3: Point2D = { x: 15, y: 25 },
  start: number = 0.70,
  end: number = 0.98
): RayState {
  const safeStart = Number.isFinite(start) ? start : 0.70;
  const safeEnd = Number.isFinite(end) ? end : 0.98;
  const t = segmentProgress(stageProgress, safeStart, safeEnd);
  const easedU = easeInOutCubic(t);
  const pos = evaluateCubicBezier(easedU, p0, p1, p2, p3);

  let opacity = 0;
  if (t > 0 && t < 1) {
    if (t < 0.15) {
      opacity = t / 0.15;
    } else if (t > 0.85) {
      opacity = (1 - t) / 0.15;
    } else {
      opacity = 1.0;
    }
  }

  return {
    x: pos.x,
    y: pos.y,
    progress: easedU,
    opacity,
  };
}
