import type { PrismaClient } from '@prisma/client';
import {
  addDashboardMember,
  addWhatsAppPerson,
  deactivateStore,
  loadStoreTeam,
  removeDashboardMember,
  removeWhatsAppPerson,
  updateWhatsAppPerson,
} from '../people';

type Dir = {
  id: string;
  phoneE164: string;
  name: string | null;
  role: 'OWNER' | 'MANAGER' | 'STAFF';
  storeId: string | null;
  isActive: boolean;
};

function makePrisma(state: {
  directory?: Dir[];
  memberships?: Array<{ id: string; userId: string; storeId: string; role: 'OWNER' | 'MANAGER' | 'STAFF'; email: string; name?: string }>;
  users?: Array<{ id: string; email: string; isActive: boolean }>;
}) {
  const directory = [...(state.directory ?? [])];
  const memberships = [...(state.memberships ?? [])];
  const users = [...(state.users ?? [])];
  let n = 1;
  const prisma = {
    userDirectory: {
      findMany: async ({ where }: { where: { storeId: string; isActive: boolean } }) =>
        directory.filter((p) => p.storeId === where.storeId && p.isActive === where.isActive),
      findUnique: async ({ where }: { where: { phoneE164: string } }) =>
        directory.find((p) => p.phoneE164 === where.phoneE164) ?? null,
      findFirst: async ({ where }: { where: { id: string; storeId: string; isActive: boolean } }) =>
        directory.find((p) => p.id === where.id && p.storeId === where.storeId && p.isActive === where.isActive) ?? null,
      count: async ({ where }: { where: { storeId: string; isActive: boolean; role: string } }) =>
        directory.filter((p) => p.storeId === where.storeId && p.isActive === where.isActive && p.role === where.role).length,
      create: async ({ data }: { data: Omit<Dir, 'id'> }) => {
        const row = { id: `d${n++}`, ...data };
        directory.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Dir> }) => {
        const row = directory.find((p) => p.id === where.id);
        if (!row) throw new Error('missing');
        Object.assign(row, data);
        return row;
      },
    },
    userStore: {
      findMany: async ({ where }: { where: { storeId: string } }) =>
        memberships
          .filter((m) => m.storeId === where.storeId)
          .map((m) => ({ userId: m.userId, role: m.role, user: { email: m.email, name: m.name ?? null } })),
      findFirst: async ({ where }: { where: { userId: string; storeId: string } }) =>
        memberships.find((m) => m.userId === where.userId && m.storeId === where.storeId) ?? null,
      count: async ({ where }: { where: { storeId: string; role: string } }) =>
        memberships.filter((m) => m.storeId === where.storeId && m.role === where.role).length,
      create: async ({ data }: { data: { userId: string; storeId: string; role: 'OWNER' | 'MANAGER' | 'STAFF' } }) => {
        const user = users.find((u) => u.id === data.userId);
        memberships.push({
          id: `m${n++}`,
          ...data,
          email: user?.email ?? '',
        });
      },
      update: async ({ where, data }: { where: { id: string }; data: { role: string } }) => {
        const row = memberships.find((m) => m.id === where.id);
        if (row) row.role = data.role as Dir['role'];
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const i = memberships.findIndex((m) => m.id === where.id);
        if (i >= 0) memberships.splice(i, 1);
      },
    },
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => users.find((u) => u.email === where.email) ?? null,
    },
    storeConfig: {
      update: jest.fn().mockResolvedValue({}),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, directory, memberships, storeUpdate: prisma.storeConfig.update };
}

const owner = { userId: 'u1', role: 'OWNER' as const };
const manager = { userId: 'u2', role: 'MANAGER' as const };

describe('store people', () => {
  it('lists WhatsApp people and dashboard logins', async () => {
    const { prisma } = makePrisma({
      directory: [{ id: 'd1', phoneE164: '+15551111111', name: 'Pat', role: 'OWNER', storeId: 'S001', isActive: true }],
      memberships: [{ id: 'm1', userId: 'u1', storeId: 'S001', role: 'OWNER', email: 'pat@store.test', name: 'Pat' }],
    });
    const team = await loadStoreTeam(prisma, 'S001');
    expect(team.whatsapp).toEqual([{ id: 'd1', name: 'Pat', phoneE164: '+15551111111', role: 'OWNER' }]);
    expect(team.dashboard[0]).toMatchObject({ email: 'pat@store.test', role: 'OWNER' });
  });

  it('lets an owner add a partner as a second WhatsApp owner', async () => {
    const { prisma, directory } = makePrisma({
      directory: [{ id: 'd1', phoneE164: '+15551111111', name: 'Pat', role: 'OWNER', storeId: 'S001', isActive: true }],
    });
    const result = await addWhatsAppPerson(prisma, 'S001', owner, {
      name: 'Sam',
      phoneE164: '+1 555 222 2222',
      role: 'OWNER',
    });
    expect(result.ok).toBe(true);
    expect(directory.some((p) => p.phoneE164 === '+15552222222' && p.role === 'OWNER')).toBe(true);
  });

  it('does not let a manager add an owner', async () => {
    const { prisma } = makePrisma({ directory: [] });
    const result = await addWhatsAppPerson(prisma, 'S001', manager, { phoneE164: '+15553333333', role: 'OWNER' });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it('lets a manager add staff and change their own WhatsApp number later', async () => {
    const { prisma, directory } = makePrisma({
      directory: [{ id: 'd2', phoneE164: '+15554444444', name: 'Alex', role: 'STAFF', storeId: 'S001', isActive: true }],
    });
    expect((await addWhatsAppPerson(prisma, 'S001', manager, { phoneE164: '+15555555555', role: 'STAFF' })).ok).toBe(true);
    const changed = await updateWhatsAppPerson(prisma, 'S001', manager, { id: 'd2', phoneE164: '+15556666666' });
    expect(changed.ok).toBe(true);
    expect(directory.find((p) => p.id === 'd2')?.phoneE164).toBe('+15556666666');
  });

  it('keeps at least one WhatsApp owner', async () => {
    const { prisma } = makePrisma({
      directory: [{ id: 'd1', phoneE164: '+15551111111', name: 'Pat', role: 'OWNER', storeId: 'S001', isActive: true }],
    });
    const result = await removeWhatsAppPerson(prisma, 'S001', owner, 'd1');
    expect(result).toMatchObject({ ok: false, status: 409 });
  });

  it('adds a partner dashboard login after they have signed up', async () => {
    const { prisma, memberships } = makePrisma({
      users: [{ id: 'u9', email: 'sam@store.test', isActive: true }],
      memberships: [{ id: 'm1', userId: 'u1', storeId: 'S001', role: 'OWNER', email: 'pat@store.test' }],
    });
    const result = await addDashboardMember(prisma, 'S001', owner, { email: 'sam@store.test', role: 'OWNER' });
    expect(result.ok).toBe(true);
    expect(memberships.some((m) => m.userId === 'u9' && m.role === 'OWNER')).toBe(true);
  });

  it('asks them to sign up first when the email is unknown', async () => {
    const { prisma } = makePrisma({ users: [] });
    const result = await addDashboardMember(prisma, 'S001', owner, { email: 'new@store.test', role: 'OWNER' });
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it('does not let you remove your own dashboard login', async () => {
    const { prisma } = makePrisma({
      memberships: [
        { id: 'm1', userId: 'u1', storeId: 'S001', role: 'OWNER', email: 'pat@store.test' },
        { id: 'm2', userId: 'u9', storeId: 'S001', role: 'OWNER', email: 'sam@store.test' },
      ],
    });
    expect(await removeDashboardMember(prisma, 'S001', owner, 'u1')).toMatchObject({ ok: false, status: 409 });
    expect((await removeDashboardMember(prisma, 'S001', owner, 'u9')).ok).toBe(true);
  });

  it('lets an owner take a store off the dashboard without wiping reports', async () => {
    const { prisma, storeUpdate } = makePrisma({});
    expect((await deactivateStore(prisma, 'S001', owner)).ok).toBe(true);
    expect(storeUpdate).toHaveBeenCalledWith({ where: { storeId: 'S001' }, data: { active: false } });
    expect((await deactivateStore(prisma, 'S001', manager)).ok).toBe(false);
  });
});
