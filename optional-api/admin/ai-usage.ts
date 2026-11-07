import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { requireAdmin } from '../utils/auth';
import { summarizeUsage } from '../../lib/understanding/usage';

const prisma = new PrismaClient();

/**
 * GET /api/admin/ai-usage?month=2026-10
 * What the AI cost, per store, for one month (default: this month). Admin key required.
 * Costs are estimates from list prices; the OpenAI dashboard is the source of truth for the bill.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAdmin(req, res)) return;

  const now = new Date();
  const requested = typeof req.query.month === 'string' ? req.query.month : '';
  const match = /^(\d{4})-(\d{2})$/.exec(requested);
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const month = match ? Number(match[2]) : now.getUTCMonth() + 1;
  if (month < 1 || month > 12) {
    res.status(400).json({ error: 'month must look like 2026-10' });
    return;
  }
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));

  try {
    const rows = await prisma.messageLog.findMany({
      where: { createdAt: { gte: from, lt: to } },
      select: { storeId: true, createdAt: true, extractedData: true },
      take: 100000,
    });
    const { stores, total } = summarizeUsage(rows);

    const names = await prisma.storeConfig.findMany({
      where: { storeId: { in: stores.map((s) => s.storeId) } },
      select: { storeId: true, storeName: true },
    });
    const nameOf = new Map(names.map((n) => [n.storeId, n.storeName]));

    const round = (n: number) => Math.round(n * 10000) / 10000;
    res.json({
      success: true,
      month: `${year}-${String(month).padStart(2, '0')}`,
      note: 'Estimated from list prices. The OpenAI billing page is the source of truth.',
      total: { ...total, estCostUsd: round(total.estCostUsd) },
      stores: stores.map((s) => ({
        ...s,
        storeName: nameOf.get(s.storeId) ?? null,
        estCostUsd: round(s.estCostUsd),
        estCostPerMessageUsd: s.messages > 0 ? round(s.estCostUsd / s.messages) : 0,
      })),
    });
  } catch (error) {
    console.error('ai-usage failed', error instanceof Error ? error.message : error);
    res.status(500).json({ error: 'Could not load usage' });
  }
}
