// In-memory login throttle. It is per server process: on a multi-instance or
// serverless deployment each instance keeps its own counters.

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

type Entry = { failures: number; firstFailureAt: number };

const attempts = new Map<string, Entry>();

function prune(now: number) {
  for (const [key, entry] of attempts) {
    if (now - entry.firstFailureAt > WINDOW_MS) attempts.delete(key);
  }
}

/** Returns the number of seconds the client must wait, or 0 if allowed. */
export function getLoginRetryAfter(key: string): number {
  const now = Date.now();
  prune(now);
  const entry = attempts.get(key);
  if (!entry || entry.failures < MAX_FAILURES) return 0;
  return Math.ceil((entry.firstFailureAt + WINDOW_MS - now) / 1000);
}

export function recordLoginFailure(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.firstFailureAt > WINDOW_MS) {
    attempts.set(key, { failures: 1, firstFailureAt: now });
  } else {
    entry.failures += 1;
  }
}

export function clearLoginFailures(key: string): void {
  attempts.delete(key);
}
