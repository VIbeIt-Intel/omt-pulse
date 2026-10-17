import type { Request } from "express";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

const failures = new Map<string, { count: number; resetAt: number }>();

export function attemptKey(scope: string, req: Request, identifier: string): string {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return `${scope}:${ip}:${identifier.toLowerCase()}`;
}

export function isAttemptLimited(key: string): boolean {
  const row = failures.get(key);
  if (!row) return false;
  if (Date.now() > row.resetAt) {
    failures.delete(key);
    return false;
  }
  return row.count >= MAX_FAILURES;
}

export function recordFailedAttempt(key: string): void {
  const now = Date.now();
  const row = failures.get(key);
  if (!row || now > row.resetAt) {
    failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  row.count += 1;
}

export function clearFailedAttempts(key: string): void {
  failures.delete(key);
}
