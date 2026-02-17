import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse): void {
  const storeId = (req.query.storeId as string) || 'S001';

  // Different stats for each store
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
}
