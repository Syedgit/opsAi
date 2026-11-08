import type { PrismaClient } from '@prisma/client';
import {
  getWhatsAppStoreRoutingMode,
  resolveStoreIdForIncomingMessage,
} from '../whatsappStoreResolution';

function mockPrisma(state: {
  groups?: { whatsappGroupId: string; storeId: string; active: boolean }[];
  storesByPhoneId?: Record<string, { storeId: string; active: boolean }>;
}): PrismaClient {
  return {
    storeWhatsAppGroup: {
      findFirst: async ({ where }: { where: { whatsappGroupId: string; active: boolean } }) => {
        const g = (state.groups || []).find(
          (x) => x.whatsappGroupId === where.whatsappGroupId && x.active
        );
        return g ? { storeId: g.storeId } : null;
      },
    },
    storeConfig: {
      findUnique: async ({ where }: { where: { whatsappPhoneNumberId: string } }) => {
        return state.storesByPhoneId?.[where.whatsappPhoneNumberId] || null;
      },
    },
  } as unknown as PrismaClient;
}

describe('getWhatsAppStoreRoutingMode', () => {
  const original = process.env.WHATSAPP_STORE_ROUTING;

  afterEach(() => {
    if (original === undefined) delete process.env.WHATSAPP_STORE_ROUTING;
    else process.env.WHATSAPP_STORE_ROUTING = original;
  });

  it('defaults to group', () => {
    delete process.env.WHATSAPP_STORE_ROUTING;
    expect(getWhatsAppStoreRoutingMode()).toBe('group');
  });
});

describe('resolveStoreIdForIncomingMessage', () => {
  const original = process.env.WHATSAPP_STORE_ROUTING;

  afterEach(() => {
    if (original === undefined) delete process.env.WHATSAPP_STORE_ROUTING;
    else process.env.WHATSAPP_STORE_ROUTING = original;
  });

  it('resolves by group_id in group mode', async () => {
    process.env.WHATSAPP_STORE_ROUTING = 'group';
    const prisma = mockPrisma({
      groups: [{ whatsappGroupId: 'g1', storeId: 'S003', active: true }],
    });

    const result = await resolveStoreIdForIncomingMessage(prisma, 'g1', 'phone-123');
    expect(result).toEqual({ storeId: 'S003', source: 'group' });
  });

  it('returns none when group unmapped in group mode', async () => {
    process.env.WHATSAPP_STORE_ROUTING = 'group';
    const prisma = mockPrisma({ groups: [] });

    const result = await resolveStoreIdForIncomingMessage(prisma, 'unknown', 'phone-123');
    expect(result).toEqual({ storeId: null, source: 'none' });
  });

  it('falls through to phone when the group table was never created', async () => {
    process.env.WHATSAPP_STORE_ROUTING = 'both';
    const prisma = {
      storeWhatsAppGroup: {
        findFirst: async () => {
          throw Object.assign(new Error('The table `public.store_whatsapp_groups` does not exist in the current database.'), {
            code: 'P2021',
          });
        },
      },
      storeConfig: {
        findUnique: async () => ({ storeId: 'S001', active: true }),
      },
    } as unknown as PrismaClient;

    await expect(resolveStoreIdForIncomingMessage(prisma, 'g1', 'phone-123')).resolves.toEqual({
      storeId: 'S001',
      source: 'phone_number',
    });
  });
});
