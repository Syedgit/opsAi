import type { PrismaClient } from '@prisma/client';
import { completeOwnerStoreOnboarding } from '../storeOwnerOnboarding';

jest.mock('../allocateStoreId', () => ({ allocateSequentialStoreId: jest.fn().mockResolvedValue('S002') }));
jest.mock('../whatsappGroupConfig', () => ({ isGroupAutoProvisionEnabled: () => false }));
jest.mock('../whatsappGroupProvision', () => ({ startWhatsAppGroupProvision: jest.fn() }));

type Membership = { role: 'OWNER' | 'MANAGER' | 'STAFF' };

function makePrisma(memberships: Membership[], phoneTaken = false) {
  const tx = {
    storeConfig: { create: jest.fn().mockResolvedValue({}) },
    userStore: { create: jest.fn().mockResolvedValue({}) },
    userDirectory: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    userStore: { findMany: jest.fn().mockResolvedValue(memberships) },
    userDirectory: { findUnique: jest.fn().mockResolvedValue(phoneTaken ? { id: 'x' } : null) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
  } as unknown as PrismaClient;
  return { prisma, tx };
}

const base = { userId: 'u1', storeName: 'Denville Exxon' };

describe('completeOwnerStoreOnboarding', () => {
  afterEach(() => {
    delete process.env.MAX_STORES_PER_OWNER;
  });

  it('creates the first store and registers the owner phone', async () => {
    const { prisma, tx } = makePrisma([]);
    const result = await completeOwnerStoreOnboarding(prisma, { ...base, ownerPhoneE164: '+15551234567' });
    expect(result.ok).toBe(true);
    expect(tx.userStore.create).toHaveBeenCalledTimes(1);
    expect(tx.userDirectory.create).toHaveBeenCalledTimes(1);
  });

  it('requires a valid phone for the first store', async () => {
    const { prisma } = makePrisma([]);
    const result = await completeOwnerStoreOnboarding(prisma, { ...base, ownerPhoneE164: '' });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('lets an owner add another store without a phone and without a second directory entry', async () => {
    const { prisma, tx } = makePrisma([{ role: 'OWNER' }]);
    const result = await completeOwnerStoreOnboarding(prisma, { ...base, ownerPhoneE164: '' });
    expect(result).toMatchObject({ ok: true, storeId: 'S002' });
    expect(tx.storeConfig.create).toHaveBeenCalledTimes(1);
    expect(tx.userStore.create).toHaveBeenCalledWith({ data: { userId: 'u1', storeId: 'S002', role: 'OWNER' } });
    expect(tx.userDirectory.create).not.toHaveBeenCalled();
  });

  it('ignores a phone sent while adding another store, so the owner number is never re-registered', async () => {
    const { prisma, tx } = makePrisma([{ role: 'OWNER' }]);
    await completeOwnerStoreOnboarding(prisma, { ...base, ownerPhoneE164: '+15559998888' });
    expect(tx.userDirectory.create).not.toHaveBeenCalled();
  });

  it('does not let staff or managers create stores', async () => {
    for (const role of ['STAFF', 'MANAGER'] as const) {
      const { prisma, tx } = makePrisma([{ role }]);
      const result = await completeOwnerStoreOnboarding(prisma, { ...base, ownerPhoneE164: '' });
      expect(result).toMatchObject({ ok: false, status: 403 });
      expect(tx.storeConfig.create).not.toHaveBeenCalled();
    }
  });

  it('stops at the store limit', async () => {
    process.env.MAX_STORES_PER_OWNER = '2';
    const { prisma, tx } = makePrisma([{ role: 'OWNER' }, { role: 'OWNER' }]);
    const result = await completeOwnerStoreOnboarding(prisma, { ...base, ownerPhoneE164: '' });
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(tx.storeConfig.create).not.toHaveBeenCalled();
  });

  it('still rejects a phone that belongs to another account', async () => {
    const { prisma } = makePrisma([], true);
    const result = await completeOwnerStoreOnboarding(prisma, { ...base, ownerPhoneE164: '+15551234567' });
    expect(result).toMatchObject({ ok: false, status: 409 });
  });
});
