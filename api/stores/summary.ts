import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { generateBusinessSummary } from '../services/aiSummarization';
import { requireStoreAccess, isMockRequested } from '../utils/storeAccess';

const prisma = new PrismaClient();

/**
 * Get AI-powered business summary
 * GET /api/stores/summary?storeId=S001&period=today|week|month
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const storeId = req.query.storeId as string;
  const period = (req.query.period as 'today' | 'week' | 'month') || 'today';

  if (!storeId) {
    res.status(400).json({ error: 'Store ID required (?storeId=S001)' });
    return;
  }

  const useMock = isMockRequested(req);
  const access = await requireStoreAccess(req, res, prisma, storeId, useMock);
  if (!useMock && !access) return;

  try {
    const summary = await generateBusinessSummary(storeId, period);
    res.status(200).json({
      success: true,
      summary,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to generate summary', { error: errorMessage, storeId, period });
    res.status(500).json({
      error: 'Failed to generate summary',
      details: errorMessage,
    });
  }
}
