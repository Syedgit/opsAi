import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Helper function to get store-specific mock data (same as in data.ts)
function getStoreMockData(storeId: string, type: string): any[] {
  const storeData: Record<string, Record<string, any[]>> = {
    S001: {
      sales: [
        { id: '1', date: new Date('2026-01-14'), data: { cash: 2100, card: 5400, tax: 320, total_inside: 7820, notes: 'Busy day, high card transactions' }, confidence: 0.9 },
        { id: '2', date: new Date('2026-01-13'), data: { cash: 1950, card: 5200, tax: 300, total_inside: 7450, notes: 'Normal operations' }, confidence: 0.9 },
        { id: '3', date: new Date('2026-01-12'), data: { cash: 2200, card: 5800, tax: 350, total_inside: 8350, notes: 'Weekend rush' }, confidence: 0.9 },
        { id: '4', date: new Date('2026-01-11'), data: { cash: 1800, card: 4900, tax: 280, total_inside: 6980, notes: 'Quiet day' }, confidence: 0.9 },
        { id: '5', date: new Date('2026-01-10'), data: { cash: 2050, card: 5600, tax: 330, total_inside: 7980, notes: 'Steady sales' }, confidence: 0.9 },
      ],
      invoices: [
        { id: '1', date: new Date('2026-01-14'), data: { vendor: 'HLA', amount: 1290, category: 'Cigarettes', paid: 'Y', invoice_number: 'INV-2026-001', due_date: '2026-01-28', notes: 'Monthly cigarette order' }, confidence: 0.85 },
        { id: '2', date: new Date('2026-01-13'), data: { vendor: 'Pepsi', amount: 850, category: 'Beverages', paid: 'N', invoice_number: 'INV-2026-002', due_date: '2026-01-27', notes: 'Beverage restock' }, confidence: 0.85 },
      ],
      expenses: [
        { id: '1', date: new Date('2026-01-14'), data: { category: 'Utilities', amount: 450, description: 'Electricity bill', paid: 'Y', receipt: 'REC-001' }, confidence: 0.85 },
      ],
      fuel: [
        { id: '1', date: new Date('2026-01-14'), data: { gallons: 3200, fuel_sales: 11000, fuel_gp: 450 }, confidence: 0.9 },
      ],
      paidouts: [
        { id: '1', date: new Date('2026-01-14'), data: { amount: 60, reason: 'Cleaning supplies', employee: 'John' }, confidence: 0.8 },
      ],
      orders: [
        { id: '1', date: new Date('2026-01-14'), data: { order_batch_id: 'order-001', vendor_groups: [{ vendor: 'HLA', items: [{ name: 'Marlboro Red King', qty: 3, unit: 'carton' }] }] }, confidence: 0.9 },
      ],
    },
    S002: {
      sales: [{ id: '1', date: new Date('2026-01-14'), data: { cash: 3200, card: 8200, tax: 480, total_inside: 11880 }, confidence: 0.9 }],
      invoices: [{ id: '1', date: new Date('2026-01-14'), data: { vendor: 'HLA', amount: 1890, category: 'Cigarettes', paid: 'Y', invoice_number: 'INV-2026-101', due_date: '2026-01-28', notes: 'Large cigarette order' }, confidence: 0.85 }],
      expenses: [{ id: '1', date: new Date('2026-01-14'), data: { category: 'Utilities', amount: 680, description: 'Electricity bill', paid: 'Y', receipt: 'REC-101' }, confidence: 0.85 }],
      fuel: [{ id: '1', date: new Date('2026-01-14'), data: { gallons: 4500, fuel_sales: 15200, fuel_gp: 680 }, confidence: 0.9 }],
      paidouts: [{ id: '1', date: new Date('2026-01-14'), data: { amount: 85, reason: 'Cleaning supplies', employee: 'Maria' }, confidence: 0.8 }],
      orders: [{ id: '1', date: new Date('2026-01-14'), data: { order_batch_id: 'order-101', vendor_groups: [{ vendor: 'HLA', items: [{ name: 'Marlboro Red King', qty: 5, unit: 'carton' }] }] }, confidence: 0.9 }],
    },
    S003: {
      sales: [{ id: '1', date: new Date('2026-01-14'), data: { cash: 1500, card: 3800, tax: 220, total_inside: 5520 }, confidence: 0.9 }],
      invoices: [{ id: '1', date: new Date('2026-01-14'), data: { vendor: 'HLA', amount: 890, category: 'Cigarettes', paid: 'Y', invoice_number: 'INV-2026-201', due_date: '2026-01-28', notes: 'Small cigarette order' }, confidence: 0.85 }],
      expenses: [{ id: '1', date: new Date('2026-01-14'), data: { category: 'Utilities', amount: 320, description: 'Electricity bill', paid: 'Y', receipt: 'REC-201' }, confidence: 0.85 }],
      fuel: [{ id: '1', date: new Date('2026-01-14'), data: { gallons: 2200, fuel_sales: 7500, fuel_gp: 320 }, confidence: 0.9 }],
      paidouts: [{ id: '1', date: new Date('2026-01-14'), data: { amount: 40, reason: 'Cleaning supplies', employee: 'Alex' }, confidence: 0.8 }],
      orders: [{ id: '1', date: new Date('2026-01-14'), data: { order_batch_id: 'order-201', vendor_groups: [{ vendor: 'HLA', items: [{ name: 'Marlboro Red King', qty: 2, unit: 'carton' }] }] }, confidence: 0.9 }],
    },
    S004: {
      sales: [{ id: '1', date: new Date('2026-01-14'), data: { cash: 2800, card: 7200, tax: 420, total_inside: 10420 }, confidence: 0.9 }],
      invoices: [{ id: '1', date: new Date('2026-01-14'), data: { vendor: 'HLA', amount: 1650, category: 'Cigarettes', paid: 'Y', invoice_number: 'INV-2026-301', due_date: '2026-01-28', notes: 'Cigarette order' }, confidence: 0.85 }],
      expenses: [{ id: '1', date: new Date('2026-01-14'), data: { category: 'Utilities', amount: 520, description: 'Electricity bill', paid: 'Y', receipt: 'REC-301' }, confidence: 0.85 }],
      fuel: [{ id: '1', date: new Date('2026-01-14'), data: { gallons: 3800, fuel_sales: 12800, fuel_gp: 550 }, confidence: 0.9 }],
      paidouts: [{ id: '1', date: new Date('2026-01-14'), data: { amount: 70, reason: 'Cleaning supplies', employee: 'Chris' }, confidence: 0.8 }],
      orders: [{ id: '1', date: new Date('2026-01-14'), data: { order_batch_id: 'order-301', vendor_groups: [{ vendor: 'HLA', items: [{ name: 'Marlboro Red King', qty: 4, unit: 'carton' }] }] }, confidence: 0.9 }],
    },
  };

  return storeData[storeId]?.[type] || storeData.S001?.[type] || [];
}

/**
 * Unified detail endpoint - handles both real and mock data
 * Use ?mock=true to get mock data
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const storeId = req.query.storeId as string;
  const type = req.query.type as string;
  const id = req.query.id as string;
  const useMock = req.query.mock === 'true';

  if (!storeId || !type || !id) {
    res.status(400).json({ error: 'Missing required parameters: storeId, type, id' });
    return;
  }

  try {
    // Mock data
    if (useMock) {
      const mockData = getStoreMockData(storeId, type);
      const item = mockData.find((i: any) => i.id === id);

      if (!item) {
        res.status(404).json({ error: 'Item not found' });
        return;
      }

      // Serialize date to ISO string
      const serializedItem = {
        ...item,
        date: item.date instanceof Date ? item.date.toISOString() : item.date,
      };

      res.json({ item: serializedItem });
      return;
    }

    // Real data from database
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
        res.status(400).json({ error: 'Invalid type' });
        return;
    }

    const item = await prisma.pendingActions.findFirst({
      where: {
        actionId: id,
        storeId,
        type: dbType as 'STORE_SALES' | 'INVOICE_EXPENSE' | 'FUEL_SALES' | 'PAID_OUT' | 'ORDER_REQUEST',
      },
    });

    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    const formatted = {
      id: item.actionId,
      date: item.createdAt,
      data: item.payloadJson,
      confidence: item.confidence,
    };

    res.json({ item: formatted });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
}
