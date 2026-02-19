import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { startOfDay, endOfDay, startOfMonth, endOfMonth } from 'date-fns';
import { getAuthUser } from '../utils/auth';

const prisma = new PrismaClient();

/**
 * Unified stores endpoint
 * GET /api/stores - List stores
 * GET /api/stores/dashboard - Dashboard stats
 * GET /api/stores/data - Get data by type
 * GET /api/stores/detail - Get item detail
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const path = req.url?.split('?')[0] || '';
  const storeId = (req.query.storeId as string) || 'S001';
  const type = (req.query.type as string) || 'sales';
  const id = req.query.id as string;
  const useMock = req.query.mock === 'true';

  // List stores
  if (path.endsWith('/stores') && !path.includes('/dashboard') && !path.includes('/data') && !path.includes('/detail')) {
    if (useMock) {
      res.json({
        stores: [
          { id: '1', storeId: 'S001', storeName: 'Main Street Store', timezone: 'America/New_York', active: true },
          { id: '2', storeId: 'S002', storeName: 'Highway 101 Store', timezone: 'America/New_York', active: true },
          { id: '3', storeId: 'S003', storeName: 'Downtown Plaza Store', timezone: 'America/Chicago', active: true },
          { id: '4', storeId: 'S004', storeName: 'Riverside Convenience', timezone: 'America/Los_Angeles', active: true },
        ],
      });
      return;
    }

    try {
      const authUser = getAuthUser(req);
      if (authUser) {
        const userStores = await prisma.userStore.findMany({
          where: { userId: authUser.userId },
          include: { store: { select: { storeId: true, storeName: true, timezone: true, active: true } } },
        });
        const stores = userStores
          .filter((us) => us.store.active)
          .map((us) => ({
            storeId: us.store.storeId,
            storeName: us.store.storeName,
            timezone: us.store.timezone,
            active: us.store.active,
            role: us.role,
          }));
        res.json({ stores });
      } else {
        res.json({ stores: [] });
      }
    } catch (error: unknown) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
    return;
  }

  // Dashboard stats
  if (path.includes('/dashboard')) {
    if (useMock) {
      const storeStats: Record<string, any> = {
        S001: { storeId: 'S001', today: { sales: 3, invoices: 2, orders: 1 }, month: { sales: 15, invoices: 12 }, pending: 1 },
        S002: { storeId: 'S002', today: { sales: 5, invoices: 3, orders: 2 }, month: { sales: 28, invoices: 18 }, pending: 2 },
        S003: { storeId: 'S003', today: { sales: 2, invoices: 1, orders: 0 }, month: { sales: 12, invoices: 8 }, pending: 0 },
        S004: { storeId: 'S004', today: { sales: 4, invoices: 4, orders: 1 }, month: { sales: 22, invoices: 20 }, pending: 3 },
      };
      res.json(storeStats[storeId] || storeStats.S001);
      return;
    }

    try {
      const today = new Date();
      const todayStart = startOfDay(today);
      const todayEnd = endOfDay(today);
      const monthStart = startOfMonth(today);
      const monthEnd = endOfMonth(today);

      const [todaySales, todayInvoices, todayOrders, monthSales, monthInvoices, pendingCount] = await Promise.all([
        prisma.pendingActions.count({ where: { storeId, type: 'STORE_SALES', status: 'CONFIRMED', createdAt: { gte: todayStart, lte: todayEnd } } }),
        prisma.pendingActions.count({ where: { storeId, type: 'INVOICE_EXPENSE', status: 'CONFIRMED', createdAt: { gte: todayStart, lte: todayEnd } } }),
        prisma.pendingActions.count({ where: { storeId, type: 'ORDER_REQUEST', status: 'CONFIRMED', createdAt: { gte: todayStart, lte: todayEnd } } }),
        prisma.pendingActions.count({ where: { storeId, type: 'STORE_SALES', status: 'CONFIRMED', createdAt: { gte: monthStart, lte: monthEnd } } }),
        prisma.pendingActions.count({ where: { storeId, type: 'INVOICE_EXPENSE', status: 'CONFIRMED', createdAt: { gte: monthStart, lte: monthEnd } } }),
        prisma.pendingActions.count({ where: { storeId, status: 'PENDING' } }),
      ]);

      res.json({
        storeId,
        today: { sales: todaySales, invoices: todayInvoices, orders: todayOrders },
        month: { sales: monthSales, invoices: monthInvoices },
        pending: pendingCount,
      });
    } catch (error: unknown) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
    return;
  }

  // Item detail
  if (path.includes('/detail')) {
    if (!storeId || !type || !id) {
      res.status(400).json({ error: 'Missing required parameters: storeId, type, id' });
      return;
    }

    if (useMock) {
      // Mock data logic (simplified)
      res.status(404).json({ error: 'Mock detail not implemented' });
      return;
    }

    try {
      const dbTypeMap: Record<string, string> = {
        sales: 'STORE_SALES',
        invoices: 'INVOICE_EXPENSE',
        fuel: 'FUEL_SALES',
        paidouts: 'PAID_OUT',
        orders: 'ORDER_REQUEST',
      };
      const dbType = dbTypeMap[type];
      if (!dbType) {
        res.status(400).json({ error: 'Invalid type' });
        return;
      }

      const item = await prisma.pendingActions.findFirst({
        where: { actionId: id, storeId, type: dbType as any },
      });

      if (!item) {
        res.status(404).json({ error: 'Item not found' });
        return;
      }

      res.json({
        item: {
          id: item.actionId,
          date: item.createdAt,
          data: item.payloadJson,
          confidence: item.confidence,
        },
      });
    } catch (error: unknown) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
    return;
  }

  // Data by type (sales, invoices, fuel, etc.)
  if (path.includes('/data')) {
    // Import logic from data.ts - for now return 501, will be handled by data.ts file
    // Actually, let's keep data.ts separate since it has complex mock data
    res.status(404).json({ error: 'Use /api/stores/data.ts directly' });
    return;
  }

  res.status(404).json({ error: 'Not found' });
}
