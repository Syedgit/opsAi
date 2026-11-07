import type { PrismaClient } from '@prisma/client';
import { checkAiBudget, maxAiMessagesPerStorePerDay, maxAiUsdPerDay, maxAiUsdPerStorePerDay } from '../budget';

const NOW = new Date('2026-10-13T12:00:00Z');

function prismaWith(used: number, alreadyTold: number, rows: Array<{ storeId: string | null; extractedData: unknown }> = []) {
  const count = jest.fn(async ({ where }: { where: { classification: unknown } }) =>
    where.classification === 'AI_LIMIT' ? alreadyTold : used
  );
  const findMany = jest.fn(async () => rows);
  return { prisma: { messageLog: { count, findMany } } as unknown as PrismaClient, count, findMany };
}

describe('checkAiBudget', () => {
  it('allows readings under the limit', async () => {
    const { prisma } = prismaWith(19, 0);
    expect(await checkAiBudget(prisma, 'S001', NOW, 20)).toMatchObject({ allowed: true, notify: false, used: 19, limit: 20 });
  });

  it('refuses at the count limit and tells the store once', async () => {
    expect(await checkAiBudget(prismaWith(20, 0).prisma, 'S001', NOW, 20)).toMatchObject({ allowed: false, notify: true });
    expect(await checkAiBudget(prismaWith(20, 1).prisma, 'S001', NOW, 20)).toMatchObject({ allowed: false, notify: false });
  });

  it('looks only at this store, in the last 24 hours, at messages the AI handled', async () => {
    const { prisma, count } = prismaWith(0, 0);
    await checkAiBudget(prisma, 'S007', NOW, 20);
    const where = count.mock.calls[0][0].where as { storeId: string; createdAt: { gte: Date }; classification: { in: string[] } };
    expect(where.storeId).toBe('S007');
    expect(where.createdAt.gte).toEqual(new Date(NOW.getTime() - 24 * 60 * 60 * 1000));
    expect(where.classification.in).toEqual(expect.arrayContaining(['DAILY_CLOSE', 'INVOICE', 'DEPOSIT_RECEIPT']));
    expect(where.classification.in).not.toContain('CHATTER');
  });

  it('refuses when this store has already spent its dollar budget', async () => {
    const rows = [
      {
        storeId: 'S001',
        extractedData: { usage: [{ kind: 'extraction', model: 'gpt-4.1', inputTokens: 200_000, outputTokens: 50_000 }] },
      },
    ];
    // 200k * $2/M + 50k * $8/M = $0.40 + $0.40 = $0.80, over the $0.50 store cap.
    const result = await checkAiBudget(prismaWith(3, 0, rows).prisma, 'S001', NOW, 20);
    expect(result).toMatchObject({ allowed: false, notify: true });
    expect(result.spentUsd).toBeCloseTo(0.8, 6);
  });

  it('refuses when all stores together have spent the daily dollar budget', async () => {
    const rows = [
      {
        storeId: 'S001',
        extractedData: { usage: [{ kind: 'extraction', model: 'gpt-4.1', inputTokens: 200_000, outputTokens: 50_000 }] },
      },
      {
        storeId: 'S002',
        extractedData: { usage: [{ kind: 'extraction', model: 'gpt-4.1', inputTokens: 200_000, outputTokens: 50_000 }] },
      },
    ];
    const result = await checkAiBudget(prismaWith(1, 0, rows).prisma, 'S003', NOW, 20);
    expect(result.allowed).toBe(false);
    expect(result.totalSpentUsd).toBeCloseTo(1.6, 6);
  });

  it('defaults to 20 readings, $0.50 per store, and $1 overall, and can be configured', () => {
    expect(maxAiMessagesPerStorePerDay({} as NodeJS.ProcessEnv)).toBe(20);
    expect(maxAiMessagesPerStorePerDay({ MAX_AI_MESSAGES_PER_STORE_PER_DAY: '25' } as unknown as NodeJS.ProcessEnv)).toBe(25);
    expect(maxAiMessagesPerStorePerDay({ MAX_AI_MESSAGES_PER_STORE_PER_DAY: 'x' } as unknown as NodeJS.ProcessEnv)).toBe(20);
    expect(maxAiUsdPerStorePerDay({} as NodeJS.ProcessEnv)).toBe(0.5);
    expect(maxAiUsdPerDay({ MAX_AI_USD_PER_DAY: '5' } as unknown as NodeJS.ProcessEnv)).toBe(5);
  });
});
