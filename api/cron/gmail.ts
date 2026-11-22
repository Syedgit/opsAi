import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { timingSafeEqual } from 'crypto';
import { runGmailActionDigests } from '../../lib/gmail/digestJob';
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
 * GET/POST /api/cron/gmail
 * Scans connected Gmail inboxes (read-only) and DMs owners on WhatsApp for action-needed mail.
 * Auth: Bearer CRON_SECRET.
 */
async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!authorized(req)) {
    logApp('cron.gmail', { ok: false, reason: 'unauthorized' });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const result = await runGmailActionDigests(prisma, new Date());
    logApp('cron.gmail', { ok: true, ...result });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    logAppError('cron.gmail', { ok: false, ...serializeError(error) });
    res.status(500).json({ error: 'Gmail digest run failed' });
  }
}

export default loggedHandler('cron.gmail', handler);
