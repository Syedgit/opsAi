import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthUser } from '../utils/auth';
import { generateBusinessSummary } from '../services/aiSummarization';

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

  // Optional: Verify user has access to this store
  const authUser = getAuthUser(req);
  if (authUser) {
    // Could add store access check here
  }

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
