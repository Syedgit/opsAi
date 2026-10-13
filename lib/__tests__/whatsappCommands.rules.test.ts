import type { PrismaClient } from '@prisma/client';
import { handleWhatsAppCommand, isWhatsAppCommand } from '../whatsappCommands';

jest.mock('../whatsappMessaging', () => ({ sendWhatsAppMessage: jest.fn() }));
jest.mock('../googleSheetsWrite', () => ({ writeConfirmedActionToSheets: jest.fn().mockResolvedValue('skipped') }));

const rule = { includeCardSales: true, includeFuelSales: true, subtractPayouts: true, floatLeftInRegister: 0 };
const PHONE = '+15550001111';

function pendingRow(payload: Record<string, unknown>, storeId = 'S001') {
  return {
    actionId: 'a1',
    phoneE164: PHONE,
    storeId,
    type: 'STORE_SALES',
    payloadJson: payload,
    messageIdInbound: 'm1',
    status: 'PENDING',
    confidence: 0.9,
  };
}

function makePrisma(options: { role?: string; pending?: ReturnType<typeof pendingRow>[]; stores?: unknown[] } = {}) {
  const pending = options.pending ?? [];
  const update = jest.fn().mockResolvedValue({});
  const prisma = {
    userDirectory: {
      findUnique: jest.fn().mockResolvedValue({ role: options.role ?? 'OWNER', storeId: 'S001', isActive: true }),
    },
    pendingActions: {
      findFirst: jest.fn().mockResolvedValue(pending[0] ?? null),
      findMany: jest.fn().mockResolvedValue(pending),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    userStore: { findMany: jest.fn().mockResolvedValue([]) },
    storeConfig: {
      findMany: jest.fn().mockResolvedValue(
        options.stores ?? [
          { storeId: 'S001', storeName: 'Rockaway', timezone: 'America/New_York', profileJson: null },
        ]
      ),
      findUnique: jest.fn().mockResolvedValue({ storeName: 'Rockaway', profileJson: null }),
      update,
    },
  } as unknown as PrismaClient;
  return { prisma, update };
}

describe('OK learns the proposed deposit rule', () => {
  it('saves the rule and says so', async () => {
    const { prisma, update } = makePrisma({ pending: [pendingRow({ _kind: 'daily_close', suggested_deposit_rule: rule })] });
    const result = await handleWhatsAppCommand(prisma, PHONE, 'OK');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data.profileJson.depositRule).toEqual(rule);
    expect(result.message).toContain('Remembered the deposit rule for Rockaway: card + cash + gas − vendor payouts');
  });

  it('learns nothing when no rule was proposed', async () => {
    const { prisma, update } = makePrisma({ pending: [pendingRow({ _kind: 'daily_close', suggested_deposit_rule: null })] });
    const result = await handleWhatsAppCommand(prisma, PHONE, 'OK');
    expect(update).not.toHaveBeenCalled();
    expect(result.message).not.toContain('Remembered');
  });

  it('learns nothing from a legacy entry', async () => {
    const { prisma, update } = makePrisma({ pending: [pendingRow({ cash: 10 })] });
    await handleWhatsAppCommand(prisma, PHONE, 'OK');
    expect(update).not.toHaveBeenCalled();
  });

  it('does not learn anything on CANCEL', async () => {
    const { prisma, update } = makePrisma({ pending: [pendingRow({ _kind: 'daily_close', suggested_deposit_rule: rule })] });
    await handleWhatsAppCommand(prisma, PHONE, 'CANCEL');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('RULE command', () => {
  const stores = [
    { storeId: 'S001', storeName: 'Rockaway', timezone: 'America/New_York', profileJson: { depositRule: rule } },
    { storeId: 'S002', storeName: 'Denville', timezone: 'America/New_York', profileJson: null },
  ];

  it('is recognised as a command', () => {
    expect(isWhatsAppCommand('RULE')).toBe(true);
    expect(isWhatsAppCommand('rule clear denville')).toBe(true);
  });

  it('lists each store with its rule or "not set yet"', async () => {
    const { prisma } = makePrisma({ stores });
    const result = await handleWhatsAppCommand(prisma, PHONE, 'RULE');
    expect(result.message).toContain('Rockaway: deposit = card + cash + gas − vendor payouts');
    expect(result.message).toContain('Denville: not set yet');
  });

  it('clears one store by name, tolerating a misspelling', async () => {
    const { prisma, update } = makePrisma({ stores: [stores[0], { ...stores[1], profileJson: { depositRule: rule } }] });
    (prisma.storeConfig.findUnique as jest.Mock).mockResolvedValue({ profileJson: { depositRule: rule } });
    const result = await handleWhatsAppCommand(prisma, PHONE, 'RULE CLEAR Danville');
    expect(result.success).toBe(true);
    expect(update.mock.calls[0][0].where).toEqual({ storeId: 'S002' });
    expect(update.mock.calls[0][0].data.profileJson.depositRule).toBeNull();
  });

  it('asks which store when there are several and none is named', async () => {
    const { prisma, update } = makePrisma({ stores });
    const result = await handleWhatsAppCommand(prisma, PHONE, 'RULE CLEAR');
    expect(result.success).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('says so when the store name matches nothing', async () => {
    const { prisma, update } = makePrisma({ stores });
    const result = await handleWhatsAppCommand(prisma, PHONE, 'RULE CLEAR Springfield');
    expect(result.success).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('is only for owners and managers', async () => {
    const { prisma, update } = makePrisma({ role: 'STAFF', stores });
    const result = await handleWhatsAppCommand(prisma, PHONE, 'RULE CLEAR Rockaway');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Only owners and managers');
    expect(update).not.toHaveBeenCalled();
  });
});
