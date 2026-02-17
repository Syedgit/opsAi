import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Mock data endpoint for dashboard testing
 * Returns sample data without database access
 */
export default function handler(_req: VercelRequest, res: VercelResponse): void {
  res.json({
    stores: [
      {
        id: '1',
        storeId: 'S001',
        storeName: 'Main Street Store',
        timezone: 'America/New_York',
        active: true,
      },
      {
        id: '2',
        storeId: 'S002',
        storeName: 'Highway 101 Store',
        timezone: 'America/New_York',
        active: true,
      },
      {
        id: '3',
        storeId: 'S003',
        storeName: 'Downtown Plaza Store',
        timezone: 'America/Chicago',
        active: true,
      },
      {
        id: '4',
        storeId: 'S004',
        storeName: 'Riverside Convenience',
        timezone: 'America/Los_Angeles',
        active: true,
      },
    ],
  });
}
