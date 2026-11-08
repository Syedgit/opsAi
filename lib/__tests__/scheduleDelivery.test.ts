import type { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { handleWhatsAppCommand } from '../whatsappCommands';
import { deliverStoreMessage, postToStoreGroups } from '../whatsappMessaging';

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
    userDirectory: { findMany: jest.fn().mockResolvedValue([]) },
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

  it('posts to the chat the sheet came from even when the store has no mapped group', async () => {
    await expect(postToStoreGroups(makePrisma([]), 'S001', 'hello', 'g-from-sheet')).resolves.toBe(1);
    expect(post.mock.calls[0][1]).toMatchObject({ recipient_type: 'group', to: 'g-from-sheet' });
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
    expect(result.message).toContain("Posted this week's shifts to the Rockaway group");
    expect(post.mock.calls[0][1].text.body).toContain('Mon 9a–5p');
    expect(post.mock.calls[0][1].text.body).toContain('8h');
  });

  it('sends hours 1:1 when OK is from a personal chat and no group is linked', async () => {
    const none = await handleWhatsAppCommand(makePrisma([]), '+15550001111', 'OK');
    expect(none.message).toContain('Sent the hours to your WhatsApp');
    expect(post.mock.calls[0][1]).toMatchObject({ to: '15550001111', type: 'text', text: { body: expect.stringContaining('Maria 8h') } });
    expect(post.mock.calls[0][1].recipient_type).toBeUndefined();
  });

  it('does not claim a post when WhatsApp send fails', async () => {
    post.mockRejectedValue(new Error('meta down'));
    const failed = await handleWhatsAppCommand(makePrisma([{ whatsappGroupId: 'g1' }]), '+15550001111', 'OK');
    expect(failed.success).toBe(true);
    expect(failed.message).not.toContain('Posted the hours');
    expect(failed.message).not.toContain("Posted this week's shifts");
    expect(failed.message).not.toContain('Sent the hours');
  });

  it('posts hours to the group stamped on the sheet, even if OK is 1:1', async () => {
    const prisma = makePrisma([]);
    const row = {
      actionId: 'a1',
      phoneE164: '+15550001111',
      storeId: 'S001',
      type: 'UNKNOWN',
      payloadJson: { ...schedulePayload, source_group_id: 'g-ops' },
      messageIdInbound: 'm1',
      status: 'PENDING',
      confidence: 0.9,
    };
    (prisma.pendingActions.findFirst as jest.Mock).mockResolvedValue(row);
    (prisma.pendingActions.findMany as jest.Mock).mockResolvedValue([row]);
    const result = await handleWhatsAppCommand(prisma, '+15550001111', 'OK');
    expect(result.message).toContain("Posted this week's shifts to the Rockaway group");
    expect(post.mock.calls[0][1]).toMatchObject({ recipient_type: 'group', to: 'g-ops' });
  });
});

describe('deliverStoreMessage', () => {
  it('DMs the owner phone on a sibling store when this location has no group', async () => {
    const prisma = makePrisma([]);
    (prisma.userStore.findMany as jest.Mock).mockImplementation(async ({ where }: { where: { storeId?: string; userId?: { in: string[] } } }) => {
      if (where.storeId === 'S005') return [{ userId: 'u1', role: 'OWNER' }];
      if (where.userId?.in?.includes('u1')) {
        return [
          { userId: 'u1', storeId: 'S002', role: 'OWNER' },
          { userId: 'u1', storeId: 'S005', role: 'OWNER' },
        ];
      }
      return [];
    });
    (prisma.userDirectory.findMany as jest.Mock).mockImplementation(async ({ where }: { where: { storeId?: string | { in: string[] } } }) => {
      if (where.storeId === 'S005') return [];
      const ids = typeof where.storeId === 'object' && where.storeId?.in ? where.storeId.in : [];
      if (ids.includes('S002') || ids.includes('S005')) return [{ phoneE164: '+17325557703', role: 'OWNER' }];
      return [];
    });
    await expect(deliverStoreMessage(prisma, 'S005', 'hours for realestate')).resolves.toEqual({ posted: 1, via: 'direct' });
    expect(post.mock.calls[0][1]).toMatchObject({ to: '17325557703', text: { body: 'hours for realestate' } });
    expect(post.mock.calls[0][1].recipient_type).toBeUndefined();
  });
});
