import type { VercelRequest } from '@vercel/node';
import { sign } from 'jsonwebtoken';
import { adminEmails, isAdminRequest } from '../adminAccess';

process.env.JWT_SECRET = 'admin-access-secret';

function cookieReq(email: string): VercelRequest {
  const token = sign({ typ: 'session', userId: 'u1', email }, 'admin-access-secret');
  return { headers: { cookie: `opsai_session=${token}` } } as VercelRequest;
}

describe('adminAccess', () => {
  it('parses founder emails', () => {
    expect(adminEmails({ ADMIN_EMAILS: 'You@Store.com, other@x.com' } as NodeJS.ProcessEnv)).toEqual([
      'you@store.com',
      'other@x.com',
    ]);
  });

  it('accepts the admin API key', () => {
    const req = { headers: { authorization: 'Bearer secret-key' } } as VercelRequest;
    expect(isAdminRequest(req, { ADMIN_API_KEY: 'secret-key' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('accepts a listed founder cookie', () => {
    expect(
      isAdminRequest(cookieReq('you@store.com'), {
        ADMIN_EMAILS: 'you@store.com',
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it('rejects other owners in production', () => {
    expect(
      isAdminRequest(cookieReq('staff@store.com'), {
        ADMIN_EMAILS: 'you@store.com',
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});
