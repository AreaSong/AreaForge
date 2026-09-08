import { randomInt } from "node:crypto";

const passwordResetMinimumResponseMs = 600;
const passwordResetJitterRangeMs = 200;

interface AuthResponseTimingOptions {
  minimumMs?: number;
  jitterMs?: number;
  nowMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

export function calculateAuthResponseDelay(
  startedAtMs: number,
  options: Omit<AuthResponseTimingOptions, "sleep"> = {},
): number {
  const minimumMs = options.minimumMs ?? passwordResetMinimumResponseMs;
  const jitterMs = options.jitterMs ?? randomInt(0, passwordResetJitterRangeMs + 1);
  const elapsedMs = Math.max(0, (options.nowMs ?? Date.now()) - startedAtMs);
  return Math.max(0, minimumMs + jitterMs - elapsedMs);
}

export async function enforcePasswordResetResponseTiming(
  startedAtMs: number,
  options: AuthResponseTimingOptions = {},
): Promise<void> {
  const delayMs = calculateAuthResponseDelay(startedAtMs, options);
  if (delayMs === 0) return;
  const sleep = options.sleep ?? ((duration: number) => new Promise<void>((resolve) => setTimeout(resolve, duration)));
  await sleep(delayMs);
}
