import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Test endpoint to verify mock data endpoints are working
 */
export default function handler(_req: VercelRequest, res: VercelResponse): void {
  res.json({
    message: 'Mock data endpoints are available',
    endpoints: {
      stores: '/api/stores/mock',
      dashboard: '/api/stores/mock-dashboard?storeId=S001',
      data: '/api/stores/mock-data?storeId=S001&type=sales',
    },
    testData: {
      stores: [
        {
          id: '1',
          storeId: 'S001',
          storeName: 'Main Street Store',
          timezone: 'America/New_York',
          active: true,
        },
      ],
      dashboard: {
        storeId: 'S001',
        today: { sales: 3, invoices: 2, orders: 1 },
        month: { sales: 15, invoices: 12 },
        pending: 1,
      },
    },
  });
}
