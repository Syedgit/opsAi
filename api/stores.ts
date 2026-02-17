import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
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
