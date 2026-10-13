import type { PrismaClient } from '@prisma/client';
import { claimMessage, STALE_CLAIM_MS } from '../messageLogService';
import { checkHourlyLimit, maxMessagesPerHour, shouldReplyNotLinked } from '../rateLimit';

const params = { messageId: 'wamid.1', phoneE164: '+15550001111', messageType: 'text' };
const NOW = new Date('2026-10-13T12:00:00Z');

function prismaFor(create: jest.Mock, updateMany: jest.Mock = jest.fn()) {
  return { messageLog: { create, updateMany } } as unknown as PrismaClient;
}

describe('claimMessage', () => {
  it('lets the first delivery process the message', async () => {
    const prisma = prismaFor(jest.fn().mockResolvedValue({}));
    expect(await claimMessage(prisma, params, NOW)).toBe(true);
  });

  it('refuses a duplicate that is finished or still in progress', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = prismaFor(jest.fn().mockRejectedValue({ code: 'P2002' }), updateMany);
    expect(await claimMessage(prisma, params, NOW)).toBe(false);
  });

  it('only takes over unfinished claims older than the stale limit', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = prismaFor(jest.fn().mockRejectedValue({ code: 'P2002' }), updateMany);
    expect(await claimMessage(prisma, params, NOW)).toBe(true);
    const where = updateMany.mock.calls[0][0].where;
    expect(where.processed).toBe(false);
    expect(where.createdAt.lt).toEqual(new Date(NOW.getTime() - STALE_CLAIM_MS));
  });

  it('does not hide real database errors', async () => {
    const prisma = prismaFor(jest.fn().mockRejectedValue(new Error('connection lost')));
    await expect(claimMessage(prisma, params, NOW)).rejects.toThrow('connection lost');
  });

  it('lets only one of two simultaneous deliveries through', async () => {
    let taken = false;
    const create = jest.fn(async () => {
      if (taken) throw { code: 'P2002' };
      taken = true;
      return {};
    });
    const prisma = prismaFor(create, jest.fn().mockResolvedValue({ count: 0 }));
    const results = await Promise.all([claimMessage(prisma, params, NOW), claimMessage(prisma, params, NOW)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe('checkHourlyLimit', () => {
  const countPrisma = (n: number) => ({ messageLog: { count: jest.fn().mockResolvedValue(n) } }) as unknown as PrismaClient;

  it('allows messages up to the limit', async () => {
    expect(await checkHourlyLimit(countPrisma(60), '+1', NOW, 60)).toEqual({ allowed: true, notify: false });
  });

  it('tells the sender once, on the first message over the limit', async () => {
    expect(await checkHourlyLimit(countPrisma(61), '+1', NOW, 60)).toEqual({ allowed: false, notify: true });
    expect(await checkHourlyLimit(countPrisma(62), '+1', NOW, 60)).toEqual({ allowed: false, notify: false });
  });

  it('defaults to 60 an hour and can be configured', () => {
    expect(maxMessagesPerHour({} as NodeJS.ProcessEnv)).toBe(60);
    expect(maxMessagesPerHour({ MAX_MESSAGES_PER_HOUR: '10' } as NodeJS.ProcessEnv)).toBe(10);
    expect(maxMessagesPerHour({ MAX_MESSAGES_PER_HOUR: 'abc' } as NodeJS.ProcessEnv)).toBe(60);
  });
});

describe('shouldReplyNotLinked', () => {
  const countPrisma = (n: number) => ({ messageLog: { count: jest.fn().mockResolvedValue(n) } }) as unknown as PrismaClient;

  it('replies to a stranger once per day', async () => {
    expect(await shouldReplyNotLinked(countPrisma(0), '+1', NOW)).toBe(true);
    expect(await shouldReplyNotLinked(countPrisma(1), '+1', NOW)).toBe(false);
  });
});
