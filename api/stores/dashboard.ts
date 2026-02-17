import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { startOfDay, endOfDay, startOfMonth, endOfMonth } from 'date-fns';

const prisma = new PrismaClient();

/**
 * Unified dashboard endpoint - handles both real and mock data
 * Use ?mock=true to get mock data
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const storeId = (req.query.storeId as string) || 'S001';
  const useMock = req.query.mock === 'true';

  // Mock data
  if (useMock) {
    const storeStats: Record<string, any> = {
      S001: {
        storeId: 'S001',
        today: { sales: 3, invoices: 2, orders: 1 },
        month: { sales: 15, invoices: 12 },
        pending: 1,
      },
      S002: {
        storeId: 'S002',
        today: { sales: 5, invoices: 3, orders: 2 },
        month: { sales: 28, invoices: 18 },
        pending: 2,
      },
      S003: {
        storeId: 'S003',
        today: { sales: 2, invoices: 1, orders: 0 },
        month: { sales: 12, invoices: 8 },
        pending: 0,
      },
      S004: {
        storeId: 'S004',
        today: { sales: 4, invoices: 4, orders: 1 },
        month: { sales: 22, invoices: 20 },
        pending: 3,
      },
    };

    res.json(storeStats[storeId] || storeStats.S001);
    return;
  }

  // Real data from database
  if (!storeId) {
    res.status(400).json({ error: 'Store ID required (query param: ?storeId=S001)' });
    return;
  }

  try {
    const today = new Date();
    const todayStart = startOfDay(today);
    const todayEnd = endOfDay(today);
    const monthStart = startOfMonth(today);
    const monthEnd = endOfMonth(today);

    // Get today's stats
    const todaySales = await prisma.pendingActions.count({
      where: {
        storeId,
        type: 'STORE_SALES',
        status: 'CONFIRMED',
        createdAt: { gte: todayStart, lte: todayEnd },
      },
    });

    const todayInvoices = await prisma.pendingActions.count({
      where: {
        storeId,
        type: 'INVOICE_EXPENSE',
        status: 'CONFIRMED',
        createdAt: { gte: todayStart, lte: todayEnd },
      },
    });

    const todayOrders = await prisma.pendingActions.count({
      where: {
        storeId,
        type: 'ORDER_REQUEST',
        status: 'CONFIRMED',
        createdAt: { gte: todayStart, lte: todayEnd },
      },
    });

    // Get monthly stats
    const monthSales = await prisma.pendingActions.count({
      where: {
        storeId,
        type: 'STORE_SALES',
        status: 'CONFIRMED',
        createdAt: { gte: monthStart, lte: monthEnd },
      },
    });

    const monthInvoices = await prisma.pendingActions.count({
      where: {
        storeId,
        type: 'INVOICE_EXPENSE',
        status: 'CONFIRMED',
        createdAt: { gte: monthStart, lte: monthEnd },
      },
    });

    // Get pending actions count
    const pendingCount = await prisma.pendingActions.count({
      where: {
        storeId,
        status: 'PENDING',
      },
    });

    res.json({
      storeId,
      today: {
        sales: todaySales,
        invoices: todayInvoices,
        orders: todayOrders,
      },
      month: {
        sales: monthSales,
        invoices: monthInvoices,
      },
      pending: pendingCount,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
}
