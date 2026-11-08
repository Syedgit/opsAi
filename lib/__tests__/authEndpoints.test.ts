import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { sign } from 'jsonwebtoken';
import { SESSION_COOKIE } from '../authCookie';
import { DUPLICATE_EMAIL_ERROR, INVALID_LOGIN_ERROR, NO_PASSWORD_ERROR } from '../authCredentials';
import { AUTH_LOCKED, AUTH_MAX_EMAIL_FAILURES, AUTH_MAX_IP_ATTEMPTS, resetAuthLimits } from '../authLimit';
import { WA_LINK_ERROR, signWhatsAppLogin } from '../whatsappLogin';

const userFindUnique = jest.fn();
const userCreate = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: function PrismaClient() {
    return {
      user: { findUnique: userFindUnique, create: userCreate },
    };
  },
}));

import handler from '../../api/auth/index';

process.env.JWT_SECRET = 'test-secret';

async function run(req: Record<string, unknown>) {
  let status = 200;
  let body: Record<string, unknown> = {};
  const headers: Record<string, string> = {};
  const res = {
    status(code: number) {
      status = code;
      return res;
    },
    json(payload: Record<string, unknown>) {
      body = payload;
      return res;
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      headers[name] = String(value);
      return res;
    },
  };
  await handler(req as never, res as never);
  return { status, body, headers };
}

function expectSessionCookie(headers: Record<string, string>) {
  const cookie = headers['Set-Cookie'] || '';
  expect(cookie).toContain(`${SESSION_COOKIE}=`);
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  expect(cookie).toContain('Path=/');
  return cookie;
}

const signupBody = {
  name: 'Sam Owner',
  email: 'sam@store.com',
  password: 'secret123',
  passwordConfirm: 'secret123',
};

describe('POST /api/auth/signup', () => {
  beforeEach(() => {
    resetAuthLimits();
    userFindUnique.mockReset();
    userCreate.mockReset();
  });

  it('creates the user and sets an HttpOnly session cookie', async () => {
    userFindUnique.mockResolvedValue(null);
    userCreate.mockResolvedValue({ id: 'u1', email: 'sam@store.com', name: 'Sam Owner' });

    const { status, body, headers } = await run({
      method: 'POST',
      url: '/api/auth/signup',
      body: signupBody,
      headers: {},
    });

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.token).toBeUndefined();
    expectSessionCookie(headers);
    expect(body.user).toMatchObject({
      id: 'u1',
      email: 'sam@store.com',
      name: 'Sam Owner',
      stores: [],
    });
    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'sam@store.com',
          name: 'Sam Owner',
          provider: 'email',
          plan: 'store',
          planStatus: 'trial',
        }),
      }),
    );
    const created = (userCreate as jest.Mock).mock.calls[0][0].data;
    expect(created.trialEndsAt).toBeInstanceOf(Date);
  });

  it('rejects a duplicate email', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1' });
    const { status, body } = await run({
      method: 'POST',
      url: '/api/auth/signup',
      body: signupBody,
      headers: {},
    });
    expect(status).toBe(409);
    expect(body.error).toBe(DUPLICATE_EMAIL_ERROR);
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('validates before hitting the database', async () => {
    const { status, body } = await run({
      method: 'POST',
      url: '/api/auth/signup',
      body: { ...signupBody, password: 'short', passwordConfirm: 'short' },
      headers: {},
    });
    expect(status).toBe(400);
    expect(body.error).toBe('Password must be at least 8 characters');
    expect(userFindUnique).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    resetAuthLimits();
    userFindUnique.mockReset();
    userCreate.mockReset();
  });

  it('sets a session cookie for a matching password', async () => {
    const password = await bcrypt.hash('secret123', 4);
    userFindUnique.mockResolvedValue({
      id: 'u1',
      email: 'sam@store.com',
      name: 'Sam Owner',
      password,
      isActive: true,
      stores: [],
    });

    const { status, body, headers } = await run({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'SAM@store.com', password: 'secret123' },
      headers: {},
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.token).toBeUndefined();
    expectSessionCookie(headers);
    expect(userFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: 'sam@store.com' } }));
  });

  it('does not tell the user to use Google', async () => {
    userFindUnique.mockResolvedValue({
      id: 'u1',
      email: 'sam@store.com',
      name: 'Sam',
      password: null,
      isActive: true,
      stores: [],
    });
    const { status, body } = await run({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'sam@store.com', password: 'secret123' },
      headers: {},
    });
    expect(status).toBe(401);
    expect(body.error).toBe(NO_PASSWORD_ERROR);
    expect(String(body.error)).not.toMatch(/google/i);
  });

  it('exchanges a WhatsApp tap-link for a session', async () => {
    const link = signWhatsAppLogin({ id: 'u1', email: 'sam@store.com' }, 'S001');
    userFindUnique.mockResolvedValue({
      id: 'u1',
      email: 'sam@store.com',
      name: 'Sam',
      isActive: true,
      stores: [{ role: 'OWNER', store: { storeId: 'S001', storeName: 'Rockaway' } }],
    });
    const { status, body, headers } = await run({
      method: 'POST',
      url: '/api/auth/login',
      body: { link },
      headers: {},
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.token).toBeUndefined();
    expectSessionCookie(headers);
    expect(userFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' } }));
  });

  it('rejects a tap-link for staff', async () => {
    const link = signWhatsAppLogin({ id: 'u1', email: 'sam@store.com' }, 'S001');
    userFindUnique.mockResolvedValue({
      id: 'u1',
      email: 'sam@store.com',
      name: 'Sam',
      isActive: true,
      stores: [{ role: 'STAFF', store: { storeId: 'S001', storeName: 'Rockaway' } }],
    });
    const { status, body } = await run({
      method: 'POST',
      url: '/api/auth/login',
      body: { link },
      headers: {},
    });
    expect(status).toBe(401);
    expect(body.error).toBe(WA_LINK_ERROR);
  });

  it('rejects a garbage tap-link', async () => {
    const { status, body } = await run({
      method: 'POST',
      url: '/api/auth/login',
      body: { link: 'not-a-token' },
      headers: {},
    });
    expect(status).toBe(401);
    expect(body.error).toBe(WA_LINK_ERROR);
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it('rejects a wrong password', async () => {
    const password = await bcrypt.hash('secret123', 4);
    userFindUnique.mockResolvedValue({
      id: 'u1',
      email: 'sam@store.com',
      name: 'Sam',
      password,
      isActive: true,
      stores: [],
    });
    const { status, body } = await run({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'sam@store.com', password: 'wrong-password' },
      headers: {},
    });
    expect(status).toBe(401);
    expect(body.error).toBe(INVALID_LOGIN_ERROR);
  });

  it('locks an email after too many failed guesses', async () => {
    userFindUnique.mockResolvedValue(null);
    for (let i = 0; i < AUTH_MAX_EMAIL_FAILURES; i += 1) {
      const failed = await run({
        method: 'POST',
        url: '/api/auth/login',
        body: { email: 'lock@store.com', password: 'wrong-password' },
        headers: { 'x-forwarded-for': '203.0.113.9' },
      });
      expect(failed.status).toBe(401);
    }
    const locked = await run({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'lock@store.com', password: 'secret123' },
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe(AUTH_LOCKED);
    expect(locked.headers['Retry-After']).toMatch(/^\d+$/);
    expect(userFindUnique).toHaveBeenCalledTimes(AUTH_MAX_EMAIL_FAILURES);
  });

  it('locks an IP after too many signup attempts', async () => {
    userFindUnique.mockResolvedValue({ id: 'u1' });
    for (let i = 0; i < AUTH_MAX_IP_ATTEMPTS; i += 1) {
      const blocked = await run({
        method: 'POST',
        url: '/api/auth/signup',
        body: { ...signupBody, email: `n${i}@store.com` },
        headers: { 'x-forwarded-for': '198.51.100.4' },
      });
      expect(blocked.status).toBe(409);
    }
    const locked = await run({
      method: 'POST',
      url: '/api/auth/signup',
      body: signupBody,
      headers: { 'x-forwarded-for': '198.51.100.4' },
    });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe(AUTH_LOCKED);
  });
});

describe('GET /api/auth/me', () => {
  beforeEach(() => {
    resetAuthLimits();
    userFindUnique.mockReset();
  });

  it('returns the user for a valid Bearer token', async () => {
    const token = sign({ typ: 'session', userId: 'u1', email: 'sam@store.com' }, 'test-secret');
    userFindUnique.mockResolvedValue({
      id: 'u1',
      email: 'sam@store.com',
      name: 'Sam Owner',
      isActive: true,
      stores: [{ role: 'OWNER', store: { storeId: 'S001', storeName: 'Rockaway' } }],
    });
    const { status, body } = await run({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(body.user).toMatchObject({
      id: 'u1',
      stores: [{ storeId: 'S001', storeName: 'Rockaway', role: 'OWNER' }],
    });
  });

  it('returns the user from the HttpOnly session cookie', async () => {
    const token = sign({ typ: 'session', userId: 'u1', email: 'sam@store.com' }, 'test-secret');
    userFindUnique.mockResolvedValue({
      id: 'u1',
      email: 'sam@store.com',
      name: 'Sam Owner',
      isActive: true,
      stores: [{ role: 'OWNER', store: { storeId: 'S001', storeName: 'Rockaway' } }],
    });
    const { status, body } = await run({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    });
    expect(status).toBe(200);
    expect(body.user).toMatchObject({ id: 'u1', email: 'sam@store.com' });
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    const { status, body, headers } = await run({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {},
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(headers['Set-Cookie']).toContain(`${SESSION_COOKIE}=`);
    expect(headers['Set-Cookie']).toContain('Max-Age=0');
  });
});

describe('owner pages', () => {
  it('do not keep a JWT in localStorage or send it as Bearer', () => {
    const files = [
      'login.html',
      'signup.html',
      'dashboard.html',
      'onboarding.html',
      'tasks.html',
      'billing.html',
      'index.html',
    ];
    for (const file of files) {
      const html = fs.readFileSync(path.join(__dirname, '../../public', file), 'utf8');
      expect(html).not.toMatch(/authToken/);
      expect(html).not.toMatch(/Bearer /);
    }
  });
});
