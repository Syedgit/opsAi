import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { requireStoreAccess, isMockRequested } from '../../lib/storeAccess';
import { readJsonBody } from '../../lib/authCredentials';
import { aiReportInsights, loadStoreReport, type ReportPeriod } from '../../lib/storeReport';
import { logAppError, loggedHandler, serializeError } from '../../lib/requestLog';

const prisma = new PrismaClient();

function queryString(req: VercelRequest, key: string): string | null {
  const value = req.query?.[key];
  if (typeof value === 'string' && value) return value;
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0]) return value[0];
  return null;
}

function periodOf(value: string | null): ReportPeriod {
  if (value === 'month' || value === 'custom') return value;
  return 'week';
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const storeId = (queryString(req, 'storeId') || '').toUpperCase();
  if (!storeId) {
    res.status(400).json({ error: 'Store ID required (?storeId=S001)' });
    return;
  }

  const useMock = isMockRequested(req);
  const access = await requireStoreAccess(req, res, prisma, storeId, useMock);
  if (!useMock && !access) return;

  try {
    if (req.method === 'POST') {
      const body = readJsonBody(req.body);
      const report = await loadStoreReport(prisma, storeId, {
        period: periodOf(typeof body.period === 'string' ? body.period : queryString(req, 'period')),
        from: typeof body.from === 'string' ? body.from : queryString(req, 'from'),
        to: typeof body.to === 'string' ? body.to : queryString(req, 'to'),
      });
      if ('error' in report) {
        res.status(report.status).json({ error: report.error });
        return;
      }
      const ai = await aiReportInsights(report);
      res.status(200).json({ success: true, report, ...ai });
      return;
    }

    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const report = await loadStoreReport(prisma, storeId, {
      period: periodOf(queryString(req, 'period')),
      from: queryString(req, 'from'),
      to: queryString(req, 'to'),
    });
    if ('error' in report) {
      res.status(report.status).json({ error: report.error });
      return;
    }
    res.status(200).json({ success: true, report });
  } catch (error: unknown) {
    logAppError('stores.summary', { storeId, ...serializeError(error) });
    res.status(500).json({ error: 'Failed to load report' });
  }
}

export default loggedHandler('stores.summary', handler);
