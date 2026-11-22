import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { getAuthUser } from '../../lib/apiAuth';
import {
  addGmailOwnerRule,
  disconnectGmail,
  getGmailPublicStatus,
  removeGmailOwnerRule,
  upsertGmailConnection,
} from '../../lib/gmail/connection';
import {
  buildGmailAuthUrl,
  exchangeGmailCode,
  gmailConfigured,
  signGmailOAuthState,
  verifyGmailOAuthState,
} from '../../lib/gmail/oauth';
import { isOwnerRole } from '../../lib/understanding/storeProfiles';
import { logApp, logAppError, loggedHandler, serializeError } from '../../lib/requestLog';

const prisma = new PrismaClient();

function stepOf(url?: string): 'status' | 'start' | 'callback' | 'disconnect' | 'rules' | null {
  const path = (url || '').split('?')[0].replace(/\/+$/, '');
  if (path.endsWith('/rules')) return 'rules';
  if (path.endsWith('/disconnect')) return 'disconnect';
  if (path.endsWith('/callback')) return 'callback';
  if (path.endsWith('/start')) return 'start';
  if (path.endsWith('/gmail') || path.endsWith('/status')) return 'status';
  return null;
}

function queryString(req: VercelRequest, name: string): string | null {
  const raw = req.query[name];
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].trim()) return raw[0].trim();
  return null;
}

function bodyObj(req: VercelRequest): Record<string, unknown> {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    ? (req.body as Record<string, unknown>)
    : {};
}

async function requireStoreOwner(
  userId: string,
  storeId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const membership = await prisma.userStore.findUnique({
    where: { userId_storeId: { userId, storeId } },
    select: { role: true },
  });
  if (!membership) return { ok: false, status: 403, error: 'Not a member of this business' };
  if (!isOwnerRole(String(membership.role))) {
    return { ok: false, status: 403, error: 'Only the business owner can manage Gmail' };
  }
  return { ok: true };
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const step = stepOf(req.url) || (req.method === 'DELETE' ? 'disconnect' : 'status');

  if (step === 'status' && req.method === 'GET') {
    const auth = getAuthUser(req);
    if (!auth) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const storeId = queryString(req, 'storeId');
    if (!storeId) {
      res.status(400).json({ error: 'storeId required' });
      return;
    }
    const membership = await prisma.userStore.findUnique({
      where: { userId_storeId: { userId: auth.userId, storeId } },
      select: { role: true },
    });
    if (!membership) {
      res.status(403).json({ error: 'Not a member of this business' });
      return;
    }
    const gmail = await getGmailPublicStatus(prisma, storeId);
    res.status(200).json({ success: true, gmail });
    return;
  }

  if (step === 'start' && req.method === 'GET') {
    const auth = getAuthUser(req);
    if (!auth) {
      res.redirect('/login?next=' + encodeURIComponent('/tasks'));
      return;
    }
    if (!gmailConfigured()) {
      res.redirect('/tasks?gmail=not_configured');
      return;
    }
    const storeId = queryString(req, 'storeId');
    if (!storeId) {
      res.redirect('/tasks?gmail=invalid');
      return;
    }
    const gate = await requireStoreOwner(auth.userId, storeId);
    if (!gate.ok) {
      res.redirect('/tasks?storeId=' + encodeURIComponent(storeId) + '&gmail=owner_only');
      return;
    }
    const state = signGmailOAuthState({ userId: auth.userId, storeId });
    const url = buildGmailAuthUrl(state);
    logApp('gmail.oauth.start', { userId: auth.userId, storeId });
    res.redirect(url);
    return;
  }

  if (step === 'callback' && req.method === 'GET') {
    const err = queryString(req, 'error');
    const stateTok = queryString(req, 'state');
    const code = queryString(req, 'code');
    const state = stateTok ? verifyGmailOAuthState(stateTok) : null;
    const back = state?.storeId
      ? `/tasks?storeId=${encodeURIComponent(state.storeId)}&view=setup`
      : '/tasks?view=setup';

    if (err) {
      res.redirect(`${back}&gmail=denied`);
      return;
    }
    if (!state || !code || !state.storeId) {
      res.redirect(`${back}&gmail=invalid`);
      return;
    }
    try {
      const tokens = await exchangeGmailCode(code);
      await upsertGmailConnection(prisma, {
        storeId: state.storeId,
        userId: state.userId,
        googleEmail: tokens.email,
        refreshToken: tokens.refreshToken,
        scope: tokens.scope,
      });
      logApp('gmail.oauth.ok', {
        userId: state.userId,
        storeId: state.storeId,
        email: tokens.email,
      });
      res.redirect(`${back}&gmail=connected`);
    } catch (error) {
      logAppError('gmail.oauth.fail', {
        userId: state.userId,
        storeId: state.storeId,
        ...serializeError(error),
      });
      res.redirect(`${back}&gmail=error`);
    }
    return;
  }

  if (step === 'disconnect' && (req.method === 'POST' || req.method === 'DELETE')) {
    const auth = getAuthUser(req);
    if (!auth) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const body = bodyObj(req);
    const storeId = queryString(req, 'storeId') || (typeof body.storeId === 'string' ? body.storeId : '');
    if (!storeId) {
      res.status(400).json({ error: 'storeId required' });
      return;
    }
    const gate = await requireStoreOwner(auth.userId, storeId);
    if (!gate.ok) {
      res.status(gate.status).json({ error: gate.error });
      return;
    }
    await disconnectGmail(prisma, storeId);
    logApp('gmail.oauth.disconnect', { userId: auth.userId, storeId });
    res.status(200).json({ success: true, gmail: await getGmailPublicStatus(prisma, storeId) });
    return;
  }

  if (step === 'rules') {
    const auth = getAuthUser(req);
    if (!auth) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const body = bodyObj(req);
    const storeId = queryString(req, 'storeId') || (typeof body.storeId === 'string' ? body.storeId : '');
    if (!storeId) {
      res.status(400).json({ error: 'storeId required' });
      return;
    }
    const gate = await requireStoreOwner(auth.userId, storeId);
    if (!gate.ok) {
      res.status(gate.status).json({ error: gate.error });
      return;
    }
    if (req.method === 'GET') {
      res.status(200).json({ success: true, gmail: await getGmailPublicStatus(prisma, storeId) });
      return;
    }
    if (req.method === 'POST') {
      const result = await addGmailOwnerRule(prisma, storeId, body);
      if (!result.ok) {
        res.status(result.status || 400).json({ error: result.error });
        return;
      }
      logApp('gmail.rules.add', { userId: auth.userId, storeId, rules: result.gmail.rules.length });
      res.status(200).json({ success: true, gmail: result.gmail });
      return;
    }
    if (req.method === 'DELETE') {
      const ruleId = queryString(req, 'id') || (typeof body.id === 'string' ? body.id : '');
      const result = await removeGmailOwnerRule(prisma, storeId, ruleId);
      if (!result.ok) {
        res.status(result.status || 400).json({ error: result.error });
        return;
      }
      logApp('gmail.rules.remove', { userId: auth.userId, storeId, ruleId });
      res.status(200).json({ success: true, gmail: result.gmail });
      return;
    }
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

export default loggedHandler('connectors.gmail', handler);
