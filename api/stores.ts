import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const stores = await prisma.storeConfig.findMany({
      where: { active: true },
      include: {
        _count: {
          select: {
            // We'll need to add relations for counts
          },
        },
      },
    });

    res.json({ stores });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: errorMessage });
  }
}
