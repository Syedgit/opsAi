import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { requireCeo } from '../../lib/adminAccess';
import { loadCeoUsage } from '../../lib/ceoUsage';
import { loggedHandler, logAppError, serializeError } from '../../lib/requestLog';

const prisma = new PrismaClient();

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireCeo(req, res)) return;

  try {
    const usage = await loadCeoUsage(prisma);
    res.status(200).json({ success: true, ...usage });
  } catch (error: unknown) {
    logAppError('admin.usage', serializeError(error));
    res.status(500).json({ error: 'Failed to load usage' });
  }
}

export default loggedHandler('admin.usage', handler);
