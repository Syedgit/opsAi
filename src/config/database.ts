import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

process.once('beforeExit', async () => {
  await prisma.$disconnect();
  logger.info('Database connection closed');
});

