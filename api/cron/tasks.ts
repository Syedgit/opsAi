import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { timingSafeEqual } from 'crypto';
import { runTaskTick } from '../../lib/tasks/tick';

const prisma = new PrismaClient();

function authorized(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Without a secret the endpoint stays closed: anyone could otherwise make the system message every group.
  if (!secret || secret.length < 16) return false;
  const header = req.headers.authorization;
  const given = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * GET /api/cron/tasks
 * Creates due tasks, sends alerts and reminders, escalates stale ones. Call it every 5 minutes with
 * "Authorization: Bearer <CRON_SECRET>". Scheduler options are in the README.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!authorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const result = await runTaskTick(prisma, new Date());
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('Task tick failed', error instanceof Error ? error.message : error);
    res.status(500).json({ error: 'Task tick failed' });
  }
}
