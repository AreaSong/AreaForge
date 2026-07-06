const windowMs = 15 * 60 * 1000;
const lockMs = 10 * 60 * 1000;
const maxAttempts = 5;

interface AttemptState {
  count: number;
  resetAt: number;
  lockedUntil?: number;
}

const attempts = new Map<string, AttemptState>();

export function checkLoginRateLimit(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds?: number } {
  const state = attempts.get(key);
  if (!state) return { allowed: true };

  if (state.lockedUntil && state.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((state.lockedUntil - now) / 1000),
    };
  }

  if (state.resetAt <= now) {
    attempts.delete(key);
    return { allowed: true };
  }

  return { allowed: true };
}

export function recordLoginFailure(key: string, now = Date.now()): void {
  const current = attempts.get(key);
  const state =
    current && current.resetAt > now
      ? current
      : {
          count: 0,
          resetAt: now + windowMs,
        };

  state.count += 1;
  if (state.count >= maxAttempts) {
    state.lockedUntil = now + lockMs;
  }

  attempts.set(key, state);
}

export function clearLoginFailures(key: string): void {
  attempts.delete(key);
}
