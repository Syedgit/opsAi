import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const storeId = req.query.storeId as string;
  const type = req.query.type as string; // sales, invoices, fuel, paidouts, orders

  if (!storeId) {
    return res.status(400).json({ error: 'Store ID required (?storeId=S001)' });
  }

  if (!type) {
    return res.status(400).json({ error: 'Type required (?type=sales|invoices|fuel|paidouts|orders)' });
  }

  try {
    let dbType: string;
    switch (type) {
      case 'sales':
        dbType = 'STORE_SALES';
        break;
      case 'invoices':
        dbType = 'INVOICE_EXPENSE';
        break;
      case 'fuel':
        dbType = 'FUEL_SALES';
        break;
      case 'paidouts':
        dbType = 'PAID_OUT';
        break;
      case 'orders':
        dbType = 'ORDER_REQUEST';
        break;
      default:
        return res.status(400).json({ error: 'Invalid type' });
    }

    const data = await prisma.pendingActions.findMany({
      where: {
        storeId,
        type: dbType as any,
        status: 'CONFIRMED',
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const formatted = data.map((item) => ({
      id: item.actionId,
      date: item.createdAt,
      data: item.payloadJson,
      confidence: item.confidence,
    }));

    res.json({ [type]: formatted });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
}
