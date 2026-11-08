import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { getAuthUser, signSession } from '../../lib/apiAuth';
import { clearSessionCookie, setSessionCookie } from '../../lib/authCookie';
import {
  AUTH_LOCKED,
  clearAuthFailures,
  clientIp,
  inspectAuthLimit,
  noteAuthAttempt,
  noteAuthFailure,
} from '../../lib/authLimit';
import {
  DUPLICATE_EMAIL_ERROR,
  INVALID_LOGIN_ERROR,
  NO_PASSWORD_ERROR,
  authActionFromRequest,
  parseLoginInput,
  parseSignupInput,
  readJsonBody,
} from '../../lib/authCredentials';
import { WA_LINK_ERROR, verifyWhatsAppLogin } from '../../lib/whatsappLogin';
import { logApp, logAppError, loggedHandler, serializeError } from '../../lib/requestLog';
import { describeBilling, newAccountBilling } from '../../lib/billing/plans';

const prisma = new PrismaClient();

type StoreRow = { store: { storeId: string; storeName: string }; role: string };

function publicUser(
  user: {
    id: string;
    email: string;
    name: string | null;
    plan?: string | null;
    planStatus?: string | null;
    trialEndsAt?: Date | null;
    createdAt?: Date;
  },
  stores: StoreRow[] = [],
) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    stores: stores.map((us) => ({
      storeId: us.store.storeId,
      storeName: us.store.storeName,
      role: us.role,
    })),
    billing: describeBilling(user, stores.length),
  };
}

function rejectLocked(res: VercelResponse, retryAfterSec: number): void {
  res.setHeader('Retry-After', String(retryAfterSec));
  res.status(429).json({ error: AUTH_LOCKED });
}

function issueSession(
  req: VercelRequest,
  res: VercelResponse,
  user: { id: string; email: string; name: string | null; plan?: string | null; planStatus?: string | null; trialEndsAt?: Date | null; createdAt?: Date },
  stores: StoreRow[],
  status: number,
): void {
  setSessionCookie(res, signSession(user), req);
  res.status(status).json({
    success: true,
    user: publicUser(user, stores),
  });
}

function isDuplicateEmail(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}

/**
 * Unified auth endpoint
 * POST /api/auth/login - Login (HttpOnly session cookie)
 * POST /api/auth/signup - Signup
 * POST /api/auth/logout - Clear session cookie
 * GET /api/auth/me - Get current user
 */
async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const action = authActionFromRequest(req);
  const ip = clientIp(req);

  if (action === 'login' && req.method === 'POST') {
    try {
      const body = readJsonBody(req.body);
      if (typeof body.link === 'string' && body.link.trim()) {
        const gate = inspectAuthLimit(ip);
        if (!gate.ok) {
          rejectLocked(res, gate.retryAfterSec);
          return;
        }
        noteAuthAttempt(ip);
        const link = verifyWhatsAppLogin(body.link.trim());
        if (!link) {
          logApp('auth.login', { via: 'wa_link', ok: false });
          res.status(401).json({ error: WA_LINK_ERROR });
          return;
        }
        const linked = await prisma.user.findUnique({
          where: { id: link.userId },
          include: { stores: { include: { store: true } } },
        });
        const member = linked?.stores.find((row) => row.store.storeId === link.storeId);
        const canOpen = member?.role === 'OWNER' || member?.role === 'MANAGER';
        if (!linked || !linked.isActive || linked.email !== link.email || !canOpen) {
          logApp('auth.login', { via: 'wa_link', ok: false, storeId: link.storeId });
          res.status(401).json({ error: WA_LINK_ERROR });
          return;
        }
        logApp('auth.login', { via: 'wa_link', ok: true, storeId: link.storeId, userId: linked.id });
        issueSession(req, res, linked, linked.stores, 200);
        return;
      }

      const parsed = parseLoginInput(body);
      if (!parsed.ok) {
        res.status(parsed.status).json({ error: parsed.error });
        return;
      }

      const gate = inspectAuthLimit(ip, parsed.email);
      if (!gate.ok) {
        rejectLocked(res, gate.retryAfterSec);
        return;
      }
      noteAuthAttempt(ip);

      const user = await prisma.user.findUnique({
        where: { email: parsed.email },
        include: {
          stores: {
            include: { store: true },
          },
        },
      });

      if (!user || !user.isActive) {
        noteAuthFailure(parsed.email);
        logApp('auth.login', { via: 'password', ok: false, reason: 'no_user' });
        res.status(401).json({ error: INVALID_LOGIN_ERROR });
        return;
      }

      if (!user.password) {
        noteAuthFailure(parsed.email);
        logApp('auth.login', { via: 'password', ok: false, reason: 'no_password' });
        res.status(401).json({ error: NO_PASSWORD_ERROR });
        return;
      }

      const isValidPassword = await bcrypt.compare(parsed.password, user.password);
      if (!isValidPassword) {
        noteAuthFailure(parsed.email);
        logApp('auth.login', { via: 'password', ok: false, reason: 'bad_password' });
        res.status(401).json({ error: INVALID_LOGIN_ERROR });
        return;
      }

      clearAuthFailures(parsed.email);
      logApp('auth.login', { via: 'password', ok: true, userId: user.id, stores: user.stores.length });
      issueSession(req, res, user, user.stores, 200);
    } catch (error: unknown) {
      logAppError('auth.login', { ok: false, ...serializeError(error) });
      res.status(500).json({ error: 'Failed to login' });
    }
    return;
  }

  if (action === 'signup' && req.method === 'POST') {
    try {
      const parsed = parseSignupInput(readJsonBody(req.body));
      if (!parsed.ok) {
        res.status(parsed.status).json({ error: parsed.error });
        return;
      }

      const gate = inspectAuthLimit(ip);
      if (!gate.ok) {
        rejectLocked(res, gate.retryAfterSec);
        return;
      }
      noteAuthAttempt(ip);

      const existingUser = await prisma.user.findUnique({
        where: { email: parsed.email },
      });

      if (existingUser) {
        logApp('auth.signup', { ok: false, reason: 'duplicate' });
        res.status(409).json({ error: DUPLICATE_EMAIL_ERROR });
        return;
      }

      const hashedPassword = await bcrypt.hash(parsed.password, 10);
      const billing = newAccountBilling();
      const user = await prisma.user.create({
        data: {
          email: parsed.email,
          password: hashedPassword,
          name: parsed.name,
          provider: 'email',
          ...billing,
        },
        select: {
          id: true,
          email: true,
          name: true,
          plan: true,
          planStatus: true,
          trialEndsAt: true,
          createdAt: true,
        },
      });

      logApp('auth.signup', { ok: true, userId: user.id });
      issueSession(req, res, user, [], 201);
    } catch (error: unknown) {
      if (isDuplicateEmail(error)) {
        res.status(409).json({ error: DUPLICATE_EMAIL_ERROR });
        return;
      }
      logAppError('auth.signup', { ok: false, ...serializeError(error) });
      res.status(500).json({ error: 'Failed to create user' });
    }
    return;
  }

  if (action === 'logout' && req.method === 'POST') {
    clearSessionCookie(res, req);
    res.status(200).json({ success: true });
    return;
  }

  if (action === 'me' && req.method === 'GET') {
    try {
      const session = getAuthUser(req);
      if (!session) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: session.userId },
        include: {
          stores: {
            include: { store: true },
          },
        },
      });

      if (!user || !user.isActive) {
        res.status(401).json({ error: 'User not found or inactive' });
        return;
      }

      res.status(200).json({
        success: true,
        user: publicUser(user, user.stores),
      });
    } catch (error: unknown) {
      logAppError('auth.me', { ...serializeError(error) });
      res.status(500).json({ error: 'Failed to get user' });
    }
    return;
  }

  res.status(404).json({ error: 'Not found' });
}

export default loggedHandler('auth', handler);
