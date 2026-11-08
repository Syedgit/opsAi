import type { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { handleWhatsAppCommand } from '../whatsappCommands';
import { postToStoreGroups } from '../whatsappMessaging';

jest.mock('axios');
jest.mock('../googleSheetsWrite', () => ({ writeConfirmedActionToSheets: jest.fn().mockResolvedValue('skipped') }));

const post = axios.post as jest.Mock;

const schedulePayload = {
  _kind: 'work_schedule',
  schedule: {
    storeHint: 'Rockaway',
    weekStart: '2026-10-26',
    employees: [
      { name: 'Maria', statedTotalHours: null, adjustedHours: null, shifts: [{ date: null, day: 'Mon', start: '09:00', end: '17:00', breakMinutes: null }] },
    ],
  },
  checks: [],
};

function makePrisma(groups: unknown[] | Error) {
  const row = {
    actionId: 'a1',
    phoneE164: '+15550001111',
    storeId: 'S001',
    type: 'UNKNOWN',
    payloadJson: schedulePayload,
    messageIdInbound: 'm1',
    status: 'PENDING',
    confidence: 0.9,
  };
  return {
    pendingActions: {
      findFirst: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([row]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    storeConfig: { findUnique: jest.fn().mockResolvedValue({ storeName: 'Rockaway', whatsappPhoneNumberId: 'PNID' }) },
    userStore: { findMany: jest.fn().mockResolvedValue([]) },
    storeWhatsAppGroup: {
      findMany: groups instanceof Error ? jest.fn().mockRejectedValue(groups) : jest.fn().mockResolvedValue(groups),
    },
  } as unknown as PrismaClient;
}

const originalPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const originalRouting = process.env.WHATSAPP_STORE_ROUTING;

beforeEach(() => {
  post.mockReset().mockResolvedValue({});
  process.env.WHATSAPP_ACCESS_TOKEN = 'token';
  process.env.WHATSAPP_PHONE_NUMBER_ID = 'PNID';
  process.env.WHATSAPP_STORE_ROUTING = 'group';
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  if (originalPhoneNumberId === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  else process.env.WHATSAPP_PHONE_NUMBER_ID = originalPhoneNumberId;
  if (originalRouting === undefined) delete process.env.WHATSAPP_STORE_ROUTING;
  else process.env.WHATSAPP_STORE_ROUTING = originalRouting;
});

describe('postToStoreGroups', () => {
  it('posts once to every active group, addressed as a group', async () => {
    const prisma = makePrisma([{ whatsappGroupId: 'g1' }, { whatsappGroupId: 'g2' }]);
    await expect(postToStoreGroups(prisma, 'S001', 'hello')).resolves.toBe(2);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][0]).toContain('/PNID/messages');
    expect(post.mock.calls[0][1]).toMatchObject({ recipient_type: 'group', to: 'g1', type: 'text', text: { body: 'hello' } });
  });

  it('only looks at active groups of that store', async () => {
    const prisma = makePrisma([]);
    await postToStoreGroups(prisma, 'S001', 'hello');
    expect((prisma.storeWhatsAppGroup.findMany as jest.Mock).mock.calls[0][0]).toEqual({ where: { storeId: 'S001', active: true } });
    expect(post).not.toHaveBeenCalled();
  });

  it('reuses the owner\'s one other group when this store has none (shared Rockaway + Denville chat)', async () => {
    const prisma = makePrisma([]);
    (prisma.userStore.findMany as jest.Mock)
      .mockResolvedValueOnce([{ userId: 'u1', role: 'OWNER' }])
      .mockResolvedValueOnce([
        { storeId: 'S001', role: 'OWNER' },
        { storeId: 'S002', role: 'OWNER' },
      ]);
    (prisma.storeWhatsAppGroup.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ whatsappGroupId: 'g-shared', storeId: 'S001' }]);
    await expect(postToStoreGroups(prisma, 'S002', 'Denville close')).resolves.toBe(1);
    expect(post.mock.calls[0][1]).toMatchObject({ recipient_type: 'group', to: 'g-shared' });
  });

  it('does not guess when sibling stores each have their own group', async () => {
    const prisma = makePrisma([]);
    (prisma.userStore.findMany as jest.Mock)
      .mockResolvedValueOnce([{ userId: 'u1', role: 'OWNER' }])
      .mockResolvedValueOnce([
        { storeId: 'S001', role: 'OWNER' },
        { storeId: 'S002', role: 'OWNER' },
        { storeId: 'S003', role: 'OWNER' },
      ]);
    (prisma.storeWhatsAppGroup.findMany as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { whatsappGroupId: 'g-a', storeId: 'S001' },
        { whatsappGroupId: 'g-b', storeId: 'S003' },
      ]);
    await expect(postToStoreGroups(prisma, 'S002', 'hello')).resolves.toBe(0);
    expect(post).not.toHaveBeenCalled();
  });

  it('counts only the posts that went out, and never throws', async () => {
    post.mockRejectedValueOnce(new Error('meta down')).mockResolvedValueOnce({});
    await expect(postToStoreGroups(makePrisma([{ whatsappGroupId: 'g1' }, { whatsappGroupId: 'g2' }]), 'S001', 'x')).resolves.toBe(1);
    await expect(postToStoreGroups(makePrisma(new Error('db down')), 'S001', 'x')).resolves.toBe(0);
  });
});

describe('OK on a schedule', () => {
  it('posts the hours to the group and says so', async () => {
    const prisma = makePrisma([{ whatsappGroupId: 'g1' }]);
    const result = await handleWhatsAppCommand(prisma, '+15550001111', 'OK');
    expect(result.message).toContain('Posted the hours to the Rockaway group');
    expect(post.mock.calls[0][1].text.body).toContain('Maria 8h');
  });

  it('does not claim a post when no group is linked or the post fails', async () => {
    const none = await handleWhatsAppCommand(makePrisma([]), '+15550001111', 'OK');
    expect(none.message).not.toContain('Posted');
    post.mockRejectedValue(new Error('meta down'));
    const failed = await handleWhatsAppCommand(makePrisma([{ whatsappGroupId: 'g1' }]), '+15550001111', 'OK');
    expect(failed.success).toBe(true);
    expect(failed.message).not.toContain('Posted');
  });
});
