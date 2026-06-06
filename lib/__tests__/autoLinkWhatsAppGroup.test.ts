import type { PrismaClient } from '@prisma/client';
import {
  resolveStoreIdBySenderPhone,
  tryAutoLinkGroupFromSender,
} from '../autoLinkWhatsAppGroup';

function mockPrisma(state: {
  groups?: { whatsappGroupId: string; storeId: string; active: boolean }[];
  members?: { phoneE164: string; storeId: string; isActive: boolean }[];
  created?: { whatsappGroupId: string; storeId: string }[];
}): PrismaClient {
  const groups = [...(state.groups || [])];
  const members = new Map((state.members || []).map((m) => [m.phoneE164, m]));
  const created = state.created || [];

  return {
    storeWhatsAppGroup: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.whatsappGroupId) {
          return (
            groups.find(
              (g) => g.whatsappGroupId === where.whatsappGroupId && g.active === where.active
            ) || null
          );
        }
        if (where.storeId) {
          return groups.find((g) => g.storeId === where.storeId && g.active) || null;
        }
        return null;
      },
      create: async ({ data }: { data: { whatsappGroupId: string; storeId: string } }) => {
        groups.push({ ...data, active: true });
        created.push(data);
        return data;
      },
    },
    userDirectory: {
      findUnique: async ({ where }: { where: { phoneE164: string } }) => {
        const m = members.get(where.phoneE164);
        return m || null;
      },
    },
  } as unknown as PrismaClient;
}

describe('tryAutoLinkGroupFromSender', () => {
  it('links new group to store for registered member', async () => {
    const created: { whatsappGroupId: string; storeId: string }[] = [];
    const prisma = mockPrisma({
      members: [{ phoneE164: '+15551234567', storeId: 'S001', isActive: true }],
      created,
    });

    const result = await tryAutoLinkGroupFromSender(prisma, 'grp-abc', '+15551234567');
    expect(result).toEqual({ storeId: 'S001', linked: true });
    expect(created).toHaveLength(1);
    expect(created[0].whatsappGroupId).toBe('grp-abc');
  });

  it('returns existing mapping without re-linking', async () => {
    const prisma = mockPrisma({
      groups: [{ whatsappGroupId: 'grp-abc', storeId: 'S001', active: true }],
    });

    const result = await tryAutoLinkGroupFromSender(prisma, 'grp-abc', '+19999999999');
    expect(result).toEqual({ storeId: 'S001', linked: false });
  });

  it('returns null for unknown phone', async () => {
    const prisma = mockPrisma({
      members: [{ phoneE164: '+15551234567', storeId: 'S001', isActive: true }],
    });

    const result = await tryAutoLinkGroupFromSender(prisma, 'grp-new', '+19998887777');
    expect(result).toBeNull();
  });
});

describe('resolveStoreIdBySenderPhone', () => {
  it('resolves store from user_directory', async () => {
    const prisma = mockPrisma({
      members: [{ phoneE164: '+15551234567', storeId: 'S002', isActive: true }],
    });
    await expect(resolveStoreIdBySenderPhone(prisma, '+15551234567')).resolves.toBe('S002');
  });

  it('returns null for inactive member', async () => {
    const prisma = mockPrisma({
      members: [{ phoneE164: '+15551234567', storeId: 'S002', isActive: false }],
    });
    await expect(resolveStoreIdBySenderPhone(prisma, '+15551234567')).resolves.toBeNull();
  });
});
