import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { timingSafeEqual } from 'crypto';
import { runOwnerDigests } from '../../lib/notify/digest';
import { logApp, logAppError, loggedHandler, serializeError } from '../../lib/requestLog';

const prisma = new PrismaClient();

function authorized(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const header = req.headers.authorization;
  const given = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * GET/POST /api/cron/digest
 * Sends opted-in owner morning briefs (email + Slack). Auth: Bearer CRON_SECRET.
 */
async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!authorized(req)) {
    logApp('cron.digest', { ok: false, reason: 'unauthorized' });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const result = await runOwnerDigests(prisma, new Date());
    logApp('cron.digest', { ok: true, ...result });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    logAppError('cron.digest', { ok: false, ...serializeError(error) });
    res.status(500).json({ error: 'Digest run failed' });
  }
}

export default loggedHandler('cron.digest', handler);
