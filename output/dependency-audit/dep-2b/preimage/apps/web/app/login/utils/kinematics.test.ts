import test from "node:test";
import assert from "node:assert/strict";
import {
  clamp,
  lerp,
  smoothstep,
  segmentProgress,
  easeOutBack,
  easeInOutCubic,
  springInterpolate,
  evaluateCubicBezier,
  interpolateStrokeDashoffset,
  interpolateCardRotateY,
  interpolateCounterValue,
  interpolateStampLanding,
  getStampTransform,
  interpolateLoopbackRay,
  getLoopbackRayPosition,
} from "./kinematics";

test("clamp: normal bounds, clamping, and edge cases", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
  assert.equal(clamp(0, 0, 10), 0);
  assert.equal(clamp(10, 0, 10), 10);

  // Inverted bounds auto-swap
  assert.equal(clamp(5, 10, 0), 5);
  assert.equal(clamp(-5, 10, 0), 0);
  assert.equal(clamp(15, 10, 0), 10);

  // Non-finite edge cases
  assert.equal(clamp(Number.NaN, 0, 10), 0);
  assert.equal(clamp(Infinity, 0, 10), 10);
  assert.equal(clamp(-Infinity, 0, 10), 0);
  assert.equal(clamp(Number.NaN, Number.NaN, Number.NaN), 0);
});

test("lerp: linear interpolation and boundary behavior", () => {
  assert.equal(lerp(100, 200, 0), 100);
  assert.equal(lerp(100, 200, 1), 200);
  assert.equal(lerp(100, 200, 0.5), 150);
  assert.equal(lerp(100, 200, 0.25), 125);
  assert.equal(lerp(0, 1, 0.33), 0.33);

  // Edge cases
  assert.equal(lerp(100, 200, Number.NaN), 100);
  assert.equal(lerp(Number.NaN, 200, 0.5), 0);
  assert.equal(lerp(100, Number.NaN, 0.5), 100);
});

test("smoothstep: Hermite cubic S-curve and 0-division protection", () => {
  assert.equal(smoothstep(0, 10, -5), 0);
  assert.equal(smoothstep(0, 10, 0), 0);
  assert.equal(smoothstep(0, 10, 5), 0.5);
  assert.equal(smoothstep(0, 10, 10), 1);
  assert.equal(smoothstep(0, 10, 15), 1);

  // Zero-length interval
  assert.equal(smoothstep(5, 5, 4), 0);
  assert.equal(smoothstep(5, 5, 5), 1);
  assert.equal(smoothstep(5, 5, 6), 1);

  // Inverted bounds
  assert.equal(smoothstep(10, 0, 5), 0.5);

  // Non-finite
  assert.equal(smoothstep(0, 10, Number.NaN), 0);
});

test("segmentProgress: interval mapping and normalization", () => {
  assert.equal(segmentProgress(0.1, 0.2, 0.6), 0);
  assert.equal(segmentProgress(0.2, 0.2, 0.6), 0);
  assert.ok(Math.abs(segmentProgress(0.4, 0.2, 0.6) - 0.5) < 1e-9);
  assert.equal(segmentProgress(0.6, 0.2, 0.6), 1);
  assert.equal(segmentProgress(0.9, 0.2, 0.6), 1);

  // Zero-length sub-interval
  assert.equal(segmentProgress(0.3, 0.5, 0.5), 0);
  assert.equal(segmentProgress(0.5, 0.5, 0.5), 1);
  assert.equal(segmentProgress(0.7, 0.5, 0.5), 1);

  // Non-finite
  assert.equal(segmentProgress(Number.NaN, 0.2, 0.6), 0);
});

test("easeOutBack: overshoot characteristics and boundaries", () => {
  assert.equal(easeOutBack(0), 0);
  assert.equal(easeOutBack(1), 1);

  // Peak overshoot occurs near x ~ 0.58
  const peakVal = easeOutBack(0.5801);
  assert.ok(peakVal > 1.0, `Expected overshoot > 1.0, got ${peakVal}`);
  assert.ok(Math.abs(peakVal - 1.104) < 0.05, `Expected peak ~1.104, got ${peakVal}`);

  // Boundary clamping & non-finite input hardening
  assert.equal(easeOutBack(-1), 0);
  assert.equal(easeOutBack(2), 1);
  assert.equal(easeOutBack(Number.NaN), 0);
  assert.equal(easeOutBack(Infinity), 1);
  assert.equal(easeOutBack(-Infinity), 0);

  // Parameter c1 NaN hardening
  assert.ok(Number.isFinite(easeOutBack(0.5, Number.NaN)));
  assert.equal(easeOutBack(0.5, Number.NaN), easeOutBack(0.5, 1.70158));
});

test("easeInOutCubic: symmetry and inflection point", () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(0.5), 0.5);
  assert.equal(easeInOutCubic(1), 1);

  // Symmetry test: f(t) + f(1 - t) === 1
  const t1 = 0.25;
  const f1 = easeInOutCubic(t1);
  const f2 = easeInOutCubic(1 - t1);
  assert.ok(Math.abs(f1 + f2 - 1.0) < 1e-9);

  // Clamping and non-finite input handling
  assert.equal(easeInOutCubic(-0.5), 0);
  assert.equal(easeInOutCubic(1.5), 1);
  assert.equal(easeInOutCubic(Number.NaN), 0);
  assert.equal(easeInOutCubic(Infinity), 1);
  assert.equal(easeInOutCubic(-Infinity), 0);
});

test("springInterpolate: damped harmonic oscillator physics response", () => {
  assert.equal(springInterpolate(0), 0);
  assert.equal(springInterpolate(1), 1);

  const mid = springInterpolate(0.5);
  assert.ok(mid > 0 && mid <= 1.25, `Expected spring value between 0 and 1.25, got ${mid}`);

  // Test custom damping and stiffness (overdamped and underdamped)
  const overdamped = springInterpolate(0.6, 30, 50);
  assert.ok(overdamped > 0 && overdamped <= 1.25);

  const underdamped = springInterpolate(0.6, 6, 200);
  assert.ok(underdamped > 0 && underdamped <= 1.25);

  // Robustness against NaN damping / stiffness parameters
  const springNanParams = springInterpolate(0.5, Number.NaN, Number.NaN);
  assert.ok(Number.isFinite(springNanParams) && springNanParams > 0 && springNanParams <= 1.25);
  assert.equal(springInterpolate(1, Number.NaN, Number.NaN), 1);

  // Clamping and non-finite input handling
  assert.equal(springInterpolate(-0.5), 0);
  assert.equal(springInterpolate(1.5), 1);
  assert.equal(springInterpolate(Number.NaN), 0);
  assert.equal(springInterpolate(Infinity), 1);
  assert.equal(springInterpolate(-Infinity), 0);
});

test("evaluateCubicBezier: 2D parametric Bézier curve calculation", () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 10, y: 50 };
  const p2 = { x: 90, y: 50 };
  const p3 = { x: 100, y: 100 };

  const start = evaluateCubicBezier(0, p0, p1, p2, p3);
  assert.equal(start.x, 0);
  assert.equal(start.y, 0);

  const end = evaluateCubicBezier(1, p0, p1, p2, p3);
  assert.equal(end.x, 100);
  assert.equal(end.y, 100);

  const mid = evaluateCubicBezier(0.5, p0, p1, p2, p3);
  assert.equal(mid.x, 50);
  assert.equal(mid.y, 50);

  // Non-finite parameter handling
  const nanBez = evaluateCubicBezier(Number.NaN, p0, p1, p2, p3);
  assert.equal(nanBez.x, 0);
  assert.equal(nanBez.y, 0);
});

test("interpolateStrokeDashoffset: SVG path length progressive reveal", () => {
  const pathLen = 500;
  assert.equal(interpolateStrokeDashoffset(0.0, pathLen, 0.1, 0.9), 500);
  assert.equal(interpolateStrokeDashoffset(0.1, pathLen, 0.1, 0.9), 500);
  assert.ok(Math.abs(interpolateStrokeDashoffset(0.5, pathLen, 0.1, 0.9) - 250) < 1e-6);
  assert.equal(interpolateStrokeDashoffset(0.9, pathLen, 0.1, 0.9), 0);
  assert.equal(interpolateStrokeDashoffset(1.0, pathLen, 0.1, 0.9), 0);

  // Zero / negative / non-finite pathLength
  assert.equal(interpolateStrokeDashoffset(0.5, 0), 0);
  assert.equal(interpolateStrokeDashoffset(0.5, -100), 0);
  assert.equal(interpolateStrokeDashoffset(0.5, Number.NaN), 0);
  assert.equal(interpolateStrokeDashoffset(Number.NaN, pathLen, 0.1, 0.9), 500);
});

test("interpolateCardRotateY: 3D card perspective flipping", () => {
  assert.equal(interpolateCardRotateY(0.1, 0, 180, 0.2, 0.8), 0);
  assert.equal(interpolateCardRotateY(0.2, 0, 180, 0.2, 0.8), 0);
  assert.ok(Math.abs(interpolateCardRotateY(0.5, 0, 180, 0.2, 0.8) - 90) < 1e-6);
  assert.equal(interpolateCardRotateY(0.8, 0, 180, 0.2, 0.8), 180);
  assert.equal(interpolateCardRotateY(1.0, 0, 180, 0.2, 0.8), 180);

  // Non-finite stageProgress handling
  assert.equal(interpolateCardRotateY(Number.NaN, 0, 180, 0.2, 0.8), 0);
});

test("interpolateCounterValue: smooth numerical telemetry counter growth", () => {
  assert.equal(interpolateCounterValue(0.0, 98.6, 0, 0.1, 0.9), 0);
  assert.equal(interpolateCounterValue(0.1, 98.6, 0, 0.1, 0.9), 0);
  assert.ok(Math.abs(interpolateCounterValue(0.5, 98.6, 0, 0.1, 0.9) - 49.3) < 1e-6);
  assert.equal(interpolateCounterValue(0.9, 98.6, 0, 0.1, 0.9), 98.6);
  assert.equal(interpolateCounterValue(1.0, 98.6, 0, 0.1, 0.9), 98.6);

  // Non-finite target and dual NaN hardening
  assert.equal(interpolateCounterValue(0.5, Number.NaN, 10), 10);
  assert.equal(interpolateCounterValue(0.5, Number.NaN, Number.NaN), 0);
  assert.ok(Math.abs(interpolateCounterValue(0.5, 100, Number.NaN, 0, 1) - 50) < 1e-6);
});

test("interpolateStampLanding and getStampTransform: physical stamp landing", () => {
  // Before trigger
  assert.equal(interpolateStampLanding(0.5, 0.65, 0.85), 0);
  const before = getStampTransform(0.5, 0.65, 0.85);
  assert.equal(before.scale, 0);
  assert.equal(before.opacity, 0);

  // Non-finite stageProgress hardening (Must return 0 / invisible, NOT 2.2)
  assert.equal(interpolateStampLanding(Number.NaN), 0);
  assert.equal(interpolateStampLanding(-Infinity), 0);
  const nanTransform = getStampTransform(Number.NaN);
  assert.equal(nanTransform.scale, 0);
  assert.equal(nanTransform.opacity, 0);
  assert.equal(nanTransform.rotateDeg, -18);
  assert.equal(nanTransform.translateY, -20);

  // After completion
  assert.equal(interpolateStampLanding(0.9, 0.65, 0.85), 1.0);
  const settled = getStampTransform(0.9, 0.65, 0.85);
  assert.equal(settled.scale, 1.0);
  assert.equal(settled.opacity, 1.0);
  assert.equal(settled.rotateDeg, -6);
  assert.equal(settled.translateY, 0);

  // Overshoot during landing window
  const midLanding = interpolateStampLanding(0.75, 0.65, 0.85);
  assert.ok(midLanding > 0, `Expected positive scale factor, got ${midLanding}`);
});

test("interpolateLoopbackRay and getLoopbackRayPosition: stage 6 -> 1 energy beam", () => {
  assert.equal(interpolateLoopbackRay(0.6, 0.70, 0.98), 0);
  assert.equal(interpolateLoopbackRay(0.99, 0.70, 0.98), 1);

  const rayMid = getLoopbackRayPosition(0.84, { x: 85, y: 75 }, { x: 95, y: 95 }, { x: 10, y: 95 }, { x: 15, y: 25 }, 0.70, 0.98);
  assert.ok(rayMid.progress > 0 && rayMid.progress < 1);
  assert.ok(rayMid.opacity > 0 && rayMid.opacity <= 1);
  assert.ok(rayMid.x >= 0 && rayMid.x <= 100);
  assert.ok(rayMid.y >= 0 && rayMid.y <= 100);

  // Non-finite stageProgress handling
  const rayNan = getLoopbackRayPosition(Number.NaN);
  assert.equal(rayNan.progress, 0);
  assert.equal(rayNan.opacity, 0);
});
