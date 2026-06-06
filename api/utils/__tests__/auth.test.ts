import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sign } from 'jsonwebtoken';
import { getAuthUser, getJwtSecret, requireAdmin, requireAuthUser } from '../auth';

function mockRes(): VercelResponse {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as VercelResponse;
}

describe('getJwtSecret', () => {
  const original = process.env.JWT_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
    delete process.env.VERCEL_ENV;
    delete process.env.NODE_ENV;
  });

  it('returns configured secret', () => {
    process.env.JWT_SECRET = 'test-secret-value';
    expect(getJwtSecret()).toBe('test-secret-value');
  });

  it('throws in production when unset', () => {
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'production';
    expect(() => getJwtSecret()).toThrow('JWT_SECRET must be set');
  });
});

describe('getAuthUser', () => {
  it('returns user for valid bearer token', () => {
    process.env.JWT_SECRET = 'unit-test-secret';
    const token = sign({ userId: 'u1', email: 'a@b.com' }, getJwtSecret(), { expiresIn: '1h' });
    const req = { headers: { authorization: `Bearer ${token}` } } as VercelRequest;
    expect(getAuthUser(req)).toMatchObject({ userId: 'u1', email: 'a@b.com' });
  });

  it('returns null without header', () => {
    expect(getAuthUser({ headers: {} } as VercelRequest)).toBeNull();
  });
});

describe('requireAdmin', () => {
  const original = process.env.ADMIN_API_KEY;

  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = original;
  });

  it('rejects missing admin key config', () => {
    delete process.env.ADMIN_API_KEY;
    const res = mockRes();
    expect(requireAdmin({ headers: {} } as VercelRequest, res)).toBe(false);
    expect(res.statusCode).toBe(503);
  });

  it('accepts valid admin bearer token', () => {
    process.env.ADMIN_API_KEY = 'admin-secret';
    const res = mockRes();
    const req = { headers: { authorization: 'Bearer admin-secret' } } as VercelRequest;
    expect(requireAdmin(req, res)).toBe(true);
  });
});

describe('requireAuthUser', () => {
  it('sends 401 when unauthenticated', () => {
    const res = mockRes();
    expect(requireAuthUser({ headers: {} } as VercelRequest, res)).toBeNull();
    expect(res.statusCode).toBe(401);
  });
});
