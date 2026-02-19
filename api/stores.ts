import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { getAuthUser } from './utils/auth';

const prisma = new PrismaClient();

/**
 * Unified stores endpoint - handles both real and mock data
 * Use ?mock=true to get mock data
 * Filters stores by authenticated user if logged in
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const useMock = req.query.mock === 'true';

  // Mock data (for testing before auth is set up)
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

  // Real data from database - filter by user if authenticated
  try {
    const authUser = getAuthUser(req);

    if (authUser) {
      // User is authenticated - return only their stores
      const userStores = await prisma.userStore.findMany({
        where: {
          userId: authUser.userId,
        },
        include: {
          store: {
            select: {
              storeId: true,
              storeName: true,
              timezone: true,
              active: true,
            },
          },
        },
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
      // Not authenticated - return empty array (or you could require auth)
      res.json({ stores: [] });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
}
