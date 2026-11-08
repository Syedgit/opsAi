/**
 * Best-effort login/signup lock. Lives in memory so a cold Vercel instance
 * starts empty — still stops a burst against one function.
 */

export const AUTH_WINDOW_MS = 15 * 60 * 1000;
export const AUTH_MAX_IP_ATTEMPTS = 20;
export const AUTH_MAX_EMAIL_FAILURES = 5;

export const AUTH_LOCKED = 'Too many attempts. Wait 15 minutes and try again.';

const ipHits = new Map<string, number[]>();
const emailFails = new Map<string, number[]>();

export function resetAuthLimits(): void {
  ipHits.clear();
  emailFails.clear();
}

function headerValue(headers: Record<string, unknown> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (typeof value === 'string' && value) return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

export function clientIp(req: { headers?: Record<string, unknown> }): string {
  const forwarded = headerValue(req.headers, 'x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim().slice(0, 64) || 'unknown';
  const real = headerValue(req.headers, 'x-real-ip');
  if (real) return real.slice(0, 64);
  return 'unknown';
}

function prune(times: number[], now: number): number[] {
  return times.filter((stamp) => now - stamp < AUTH_WINDOW_MS);
}

export type AuthLimit = { ok: true } | { ok: false; retryAfterSec: number };

export function inspectAuthLimit(ip: string, email?: string): AuthLimit {
  const now = Date.now();
  const ipTimes = prune(ipHits.get(ip) || [], now);
  if (ipTimes.length >= AUTH_MAX_IP_ATTEMPTS) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((ipTimes[0] + AUTH_WINDOW_MS - now) / 1000)) };
  }
  if (email) {
    const fails = prune(emailFails.get(email) || [], now);
    if (fails.length >= AUTH_MAX_EMAIL_FAILURES) {
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((fails[0] + AUTH_WINDOW_MS - now) / 1000)) };
    }
  }
  return { ok: true };
}

export function noteAuthAttempt(ip: string): void {
  const now = Date.now();
  ipHits.set(ip, prune(ipHits.get(ip) || [], now).concat(now));
}

export function noteAuthFailure(email: string): void {
  const now = Date.now();
  emailFails.set(email, prune(emailFails.get(email) || [], now).concat(now));
}

export function clearAuthFailures(email: string): void {
  emailFails.delete(email);
}
