import {
  AUTH_LOCKED,
  AUTH_MAX_EMAIL_FAILURES,
  AUTH_MAX_IP_ATTEMPTS,
  clearAuthFailures,
  clientIp,
  inspectAuthLimit,
  noteAuthAttempt,
  noteAuthFailure,
  resetAuthLimits,
} from '../authLimit';

describe('auth login lock', () => {
  beforeEach(() => {
    resetAuthLimits();
  });

  it('reads the first forwarded IP', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } })).toBe('203.0.113.9');
    expect(clientIp({ headers: { 'x-real-ip': '198.51.100.7' } })).toBe('198.51.100.7');
    expect(clientIp({ headers: {} })).toBe('unknown');
  });

  it('locks an email after too many failures', () => {
    const email = 'owner@store.com';
    for (let i = 0; i < AUTH_MAX_EMAIL_FAILURES; i += 1) noteAuthFailure(email);
    const gate = inspectAuthLimit('203.0.113.9', email);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.retryAfterSec).toBeGreaterThan(0);
    expect(AUTH_LOCKED).toMatch(/15 minutes/i);
  });

  it('unlocks the email after a successful login', () => {
    const email = 'owner@store.com';
    for (let i = 0; i < AUTH_MAX_EMAIL_FAILURES; i += 1) noteAuthFailure(email);
    clearAuthFailures(email);
    expect(inspectAuthLimit('203.0.113.9', email)).toEqual({ ok: true });
  });

  it('locks an IP after too many attempts', () => {
    const ip = '198.51.100.4';
    for (let i = 0; i < AUTH_MAX_IP_ATTEMPTS; i += 1) noteAuthAttempt(ip);
    const gate = inspectAuthLimit(ip);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.retryAfterSec).toBeGreaterThan(0);
  });
});
