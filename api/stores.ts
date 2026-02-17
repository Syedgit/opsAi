import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Unified stores endpoint - handles both real and mock data
 * Use ?mock=true to get mock data
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const useMock = req.query.mock === 'true';

  // Mock data
  if (useMock) {
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
    return;
  }

  // Real data from database
  try {
    const stores = await prisma.storeConfig.findMany({
      where: { active: true },
      select: {
        storeId: true,
        storeName: true,
        timezone: true,
        active: true,
      },
    });

    res.json({ stores });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
}
