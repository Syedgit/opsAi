import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { startOfDay, endOfDay, startOfMonth, endOfMonth } from 'date-fns';

const prisma = new PrismaClient();

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const storeId = req.query.storeId as string;

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
