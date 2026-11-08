import bcrypt from 'bcryptjs';
import { sign } from 'jsonwebtoken';
import { DUPLICATE_EMAIL_ERROR, INVALID_LOGIN_ERROR, NO_PASSWORD_ERROR } from '../authCredentials';
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
  const res = {
    status(code: number) {
      status = code;
      return res;
    },
    json(payload: Record<string, unknown>) {
      body = payload;
      return res;
    },
  };
  await handler(req as never, res as never);
  return { status, body };
}

const signupBody = {
  name: 'Sam Owner',
  email: 'sam@store.com',
  password: 'secret123',
  passwordConfirm: 'secret123',
};

describe('POST /api/auth/signup', () => {
  beforeEach(() => {
    userFindUnique.mockReset();
    userCreate.mockReset();
  });

  it('creates the user and returns a session token', async () => {
    userFindUnique.mockResolvedValue(null);
    userCreate.mockResolvedValue({ id: 'u1', email: 'sam@store.com', name: 'Sam Owner' });

    const { status, body } = await run({
      method: 'POST',
      url: '/api/auth/signup',
      body: signupBody,
      headers: {},
    });

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(typeof body.token).toBe('string');
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
    userFindUnique.mockReset();
    userCreate.mockReset();
  });

  it('returns a token for a matching password', async () => {
    const password = await bcrypt.hash('secret123', 4);
    userFindUnique.mockResolvedValue({
      id: 'u1',
      email: 'sam@store.com',
      name: 'Sam Owner',
      password,
      isActive: true,
      stores: [],
    });

    const { status, body } = await run({
      method: 'POST',
      url: '/api/auth/login',
      body: { email: 'SAM@store.com', password: 'secret123' },
      headers: {},
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.token).toBe('string');
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
    const { status, body } = await run({
      method: 'POST',
      url: '/api/auth/login',
      body: { link },
      headers: {},
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.token).toBe('string');
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
});

describe('GET /api/auth/me', () => {
  beforeEach(() => {
    userFindUnique.mockReset();
  });

  it('returns the user for a valid token', async () => {
    const token = sign({ userId: 'u1', email: 'sam@store.com' }, 'test-secret');
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
});
