import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { getAuthUser, signSession } from '../../lib/apiAuth';
import { clearSessionCookie, setSessionCookie } from '../../lib/authCookie';
import { noteOwnerLogin } from '../../lib/ceoUsage';
import {
  AUTH_LOCKED,
  clearAuthFailures,
  clientIp,
  inspectAuthLimit,
  noteAuthAttempt,
  noteAuthFailure,
} from '../../lib/authLimit';
import {
  DESKTOP_LOGIN_ALREADY_SET,
  DUPLICATE_EMAIL_ERROR,
  INVALID_LOGIN_ERROR,
  NO_PASSWORD_ERROR,
  authActionFromRequest,
  canAddDesktopCredentials,
  isSyntheticPhoneEmail,
  parseLinkCredentialsInput,
  parseLoginInput,
  parseSignupInput,
  readJsonBody,
} from '../../lib/authCredentials';
import { WA_LINK_ERROR, verifyWhatsAppLogin } from '../../lib/whatsappLogin';
import {
  phoneAccountEmail,
  verifyPhoneSignup,
  whatsappLoginDeepLink,
  opsWhatsAppDisplayNumber,
} from '../../lib/whatsappPhoneAuth';
import { logApp, logAppError, loggedHandler, serializeError } from '../../lib/requestLog';
import { describeBilling, newAccountBilling } from '../../lib/billing/plans';

const prisma = new PrismaClient();

type StoreRow = { store: { storeId: string; storeName: string }; role: string };

function publicUser(
  user: {
    id: string;
    email: string;
    name: string | null;
    password?: string | null;
    provider?: string | null;
    providerId?: string | null;
    plan?: string | null;
    planStatus?: string | null;
    trialEndsAt?: Date | null;
    createdAt?: Date;
  },
  stores: StoreRow[] = [],
) {
  const synthetic = isSyntheticPhoneEmail(user.email);
  return {
    id: user.id,
    email: synthetic ? null : user.email,
    name: user.name,
    phoneE164: user.provider === 'whatsapp' ? user.providerId || null : null,
    hasPassword: Boolean(user.password),
    canAddDesktopLogin: canAddDesktopCredentials(user),
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

async function issueSession(
  req: VercelRequest,
  res: VercelResponse,
  user: {
    id: string;
    email: string;
    name: string | null;
    password?: string | null;
    provider?: string | null;
    providerId?: string | null;
    plan?: string | null;
    planStatus?: string | null;
    trialEndsAt?: Date | null;
    createdAt?: Date;
  },
  stores: StoreRow[],
  status: number,
): Promise<void> {
  await noteOwnerLogin(prisma, user.id);
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
 * POST /api/auth/credentials - Add email+password on the current (WhatsApp) account
 * POST /api/auth/logout - Clear session cookie
 * GET /api/auth/me - Get current user
 */
async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const action = authActionFromRequest(req);
  const ip = clientIp(req);

  if (action === 'credentials' && req.method === 'POST') {
    try {
      const session = getAuthUser(req);
      if (!session) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      const parsed = parseLinkCredentialsInput(readJsonBody(req.body));
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
        where: { id: session.userId },
        include: { stores: { include: { store: true } } },
      });
      if (!user || !user.isActive) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      if (!canAddDesktopCredentials(user)) {
        res.status(409).json({ error: DESKTOP_LOGIN_ALREADY_SET });
        return;
      }
      const taken = await prisma.user.findUnique({ where: { email: parsed.email } });
      if (taken && taken.id !== user.id) {
        res.status(409).json({ error: DUPLICATE_EMAIL_ERROR });
        return;
      }

      const hashedPassword = await bcrypt.hash(parsed.password, 10);
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: {
          email: parsed.email,
          password: hashedPassword,
          // Keep WhatsApp as the identity source; email is for desktop login only.
          provider: user.provider || 'whatsapp',
          providerId: user.providerId,
        },
        include: { stores: { include: { store: true } } },
      });
      logApp('auth.credentials', { ok: true, userId: updated.id });
      await issueSession(req, res, updated, updated.stores, 200);
    } catch (error: unknown) {
      if (isDuplicateEmail(error)) {
        res.status(409).json({ error: DUPLICATE_EMAIL_ERROR });
        return;
      }
      logAppError('auth.credentials', { ok: false, ...serializeError(error) });
      res.status(500).json({ error: 'Failed to save desktop login' });
    }
    return;
  }

  if (action === 'whatsapp' && req.method === 'GET') {
    const deepLink = whatsappLoginDeepLink('Login');
    const displayNumber = opsWhatsAppDisplayNumber();
    if (!deepLink || !displayNumber) {
      res.status(503).json({ error: 'WhatsApp login is not configured yet.' });
      return;
    }
    res.status(200).json({ success: true, deepLink, displayNumber });
    return;
  }

  if (action === 'login' && req.method === 'POST') {
    try {
      const body = readJsonBody(req.body);
      if (typeof body.phone === 'string' && body.phone.trim()) {
        const gate = inspectAuthLimit(ip);
        if (!gate.ok) {
          rejectLocked(res, gate.retryAfterSec);
          return;
        }
        noteAuthAttempt(ip);
        const proved = verifyPhoneSignup(body.phone.trim());
        if (!proved) {
          logApp('auth.login', { via: 'wa_phone', ok: false });
          res.status(401).json({ error: 'That WhatsApp link expired. Send Login to opsAi again.' });
          return;
        }
        const phoneUser = await prisma.user.findFirst({
          where: { provider: 'whatsapp', providerId: proved.phoneE164, isActive: true },
          include: { stores: { include: { store: true } } },
        });
        if (!phoneUser) {
          logApp('auth.login', { via: 'wa_phone', ok: false, reason: 'no_user' });
          res.status(401).json({ error: 'No account for that number yet. Open the signup link from WhatsApp.' });
          return;
        }
        logApp('auth.login', { via: 'wa_phone', ok: true, userId: phoneUser.id });
        await issueSession(req, res, phoneUser, phoneUser.stores, 200);
        return;
      }
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
        await issueSession(req, res, linked, linked.stores, 200);
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
      await issueSession(req, res, user, user.stores, 200);
    } catch (error: unknown) {
      logAppError('auth.login', { ok: false, ...serializeError(error) });
      res.status(500).json({ error: 'Failed to login' });
    }
    return;
  }

  if (action === 'signup' && req.method === 'POST') {
    try {
      const body = readJsonBody(req.body);
      if (typeof body.wa === 'string' && body.wa.trim()) {
        const gate = inspectAuthLimit(ip);
        if (!gate.ok) {
          rejectLocked(res, gate.retryAfterSec);
          return;
        }
        noteAuthAttempt(ip);
        const proved = verifyPhoneSignup(body.wa.trim());
        if (!proved) {
          logApp('auth.signup', { via: 'wa_phone', ok: false, reason: 'bad_token' });
          res.status(401).json({ error: 'That WhatsApp link expired. Send Start to opsAi again.' });
          return;
        }
        const nameRaw = typeof body.name === 'string' ? body.name.trim() : '';
        const name = nameRaw || 'Owner';
        if (name.length > 80) {
          res.status(400).json({ error: 'Name is too long' });
          return;
        }
        const existingPhone = await prisma.user.findFirst({
          where: { provider: 'whatsapp', providerId: proved.phoneE164 },
          include: { stores: { include: { store: true } } },
        });
        if (existingPhone?.isActive) {
          logApp('auth.signup', { via: 'wa_phone', ok: true, resumed: true, userId: existingPhone.id });
          await issueSession(req, res, existingPhone, existingPhone.stores, 200);
          return;
        }
        const email = phoneAccountEmail(proved.phoneE164);
        const billing = newAccountBilling();
        const user = await prisma.user.create({
          data: {
            email,
            password: null,
            name,
            provider: 'whatsapp',
            providerId: proved.phoneE164,
            ...billing,
          },
          select: {
            id: true,
            email: true,
            name: true,
            provider: true,
            providerId: true,
            plan: true,
            planStatus: true,
            trialEndsAt: true,
            createdAt: true,
          },
        });
        logApp('auth.signup', { via: 'wa_phone', ok: true, userId: user.id });
        await issueSession(req, res, user, [], 201);
        return;
      }

      const parsed = parseSignupInput(body);
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
      await issueSession(req, res, user, [], 201);
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
