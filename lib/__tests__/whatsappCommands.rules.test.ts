import type { PrismaClient } from '@prisma/client';
import { handleWhatsAppCommand, isWhatsAppCommand } from '../whatsappCommands';
import { postToStoreGroups, sendWhatsAppMessage } from '../whatsappMessaging';
import { defaultSetup } from '../tasks/storeSetup';

jest.mock('../whatsappMessaging', () => ({
  sendWhatsAppMessage: jest.fn(),
  postToStoreGroups: jest.fn().mockResolvedValue(0),
  deliverStoreMessage: jest.fn().mockResolvedValue({ posted: 0, via: 'none' }),
}));
jest.mock('../googleSheetsWrite', () => ({ writeConfirmedActionToSheets: jest.fn().mockResolvedValue('skipped') }));

const rule = { includeCardSales: true, includeFuelSales: true, subtractPayouts: true, floatLeftInRegister: 0 };
const PHONE = '+15550001111';

function pendingRow(payload: Record<string, unknown>, storeId = 'S001', type = 'STORE_SALES') {
  return {
    actionId: 'a1',
    phoneE164: PHONE,
    storeId,
    type,
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
      findMany: jest.fn().mockResolvedValue([]),
    },
    pendingActions: {
      findFirst: jest.fn().mockResolvedValue(pending[0] ?? null),
      findMany: jest.fn().mockResolvedValue(pending),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    taskTemplate: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 't1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    userStore: { findMany: jest.fn().mockResolvedValue([]) },
    storeConfig: {
      findMany: jest.fn().mockResolvedValue(
        options.stores ?? [
          { storeId: 'S001', storeName: 'Rockaway', timezone: 'America/New_York', profileJson: null },
        ]
      ),
      findUnique: jest.fn().mockResolvedValue({ storeId: 'S001', storeName: 'Rockaway', timezone: 'America/New_York', profileJson: null }),
      update,
    },
    inspectionReport: { findFirst: jest.fn().mockResolvedValue(null) },
  } as unknown as PrismaClient;
  return { prisma, update };
}

describe('OK learns the proposed deposit rule', () => {
  it('saves the rule and says so', async () => {
    const { prisma, update } = makePrisma({ pending: [pendingRow({ _kind: 'daily_close', suggested_deposit_rule: rule })] });
    const result = await handleWhatsAppCommand(prisma, PHONE, 'OK');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data.profileJson.depositRule).toEqual(rule);
    expect(result.message).toContain('Remembered the deposit rule for Rockaway: card + cash + gas − payouts');
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

const closePayload = {
  _kind: 'daily_close',
  cash: 106,
  card: 334,
  fuel_sales: 1355,
  deposit: 1653,
  report_date: '2026-10-12',
  report: { payouts: [{ label: 'Lays', amount: 142 }] },
};

describe('OK posts an end-of-day wrap-up', () => {
  beforeEach(() => {
    (postToStoreGroups as jest.Mock).mockReset();
    (postToStoreGroups as jest.Mock).mockResolvedValue(0);
  });

  it('for a convenience store, totals the day and posts it to the group', async () => {
    const { prisma } = makePrisma({ pending: [pendingRow(closePayload)] });
    (prisma.storeConfig.findUnique as jest.Mock).mockResolvedValue({
      storeId: 'S001',
      storeName: 'Rockaway',
      timezone: 'America/New_York',
      profileJson: null,
      setupJson: defaultSetup('convenience'),
    });
    (postToStoreGroups as jest.Mock).mockResolvedValue(1);

    const result = await handleWhatsAppCommand(prisma, PHONE, 'OK');
    expect(result.message).toContain('Sales: inside cash $106 · inside card $334 · gas $1,355');
    expect(result.message).toContain('Paid out: Lays $142');
    expect(result.message).toContain('To deposit:');
    expect(result.message).toContain('Posted to the group');
    expect(postToStoreGroups).toHaveBeenCalled();
    expect((postToStoreGroups as jest.Mock).mock.calls[0][2]).toContain('Sales:');
  });

  it('for a 7-Eleven, only lists till paid-outs as written', async () => {
    const { prisma } = makePrisma({ pending: [pendingRow(closePayload)] });
    (prisma.storeConfig.findUnique as jest.Mock).mockResolvedValue({
      storeId: 'S001',
      storeName: 'Rockaway',
      timezone: 'America/New_York',
      profileJson: null,
      setupJson: defaultSetup('seven_eleven'),
    });
    (postToStoreGroups as jest.Mock).mockResolvedValue(1);

    const result = await handleWhatsAppCommand(prisma, PHONE, 'OK');
    expect(result.message).toContain('paid outs');
    expect(result.message).toContain('Lays $142');
    expect(result.message).not.toContain('Sales:');
    expect(result.message).not.toContain('To deposit:');
    expect(result.message).not.toMatch(/wage|hourly|payroll/i);
  });

  it('sends a private dashboard link 1:1 and keeps it out of the group', async () => {
    const { prisma } = makePrisma({ pending: [pendingRow(closePayload)] });
    (prisma.storeConfig.findUnique as jest.Mock).mockResolvedValue({
      storeId: 'S001',
      storeName: 'Rockaway',
      timezone: 'America/New_York',
      profileJson: null,
      setupJson: defaultSetup('convenience'),
    });
    (prisma.userDirectory.findMany as jest.Mock).mockResolvedValue([
      { id: 'd1', name: 'Sam', phoneE164: PHONE, role: 'OWNER' },
    ]);
    (prisma.userStore.findMany as jest.Mock).mockResolvedValue([
      { userId: 'u1', role: 'OWNER', user: { email: 'sam@store.com', name: 'Sam' } },
    ]);
    (sendWhatsAppMessage as jest.Mock).mockResolvedValue(true);
    (postToStoreGroups as jest.Mock).mockResolvedValue(1);

    const result = await handleWhatsAppCommand(prisma, PHONE, 'OK');
    const privateText = (sendWhatsAppMessage as jest.Mock).mock.calls.map((c) => String(c[2])).find((t) => t.includes('/login?wa='));
    expect(privateText).toContain('/login?wa=');
    expect(privateText).toContain('expires in 20 minutes');
    const groupText = String((postToStoreGroups as jest.Mock).mock.calls[0][2]);
    expect(groupText).not.toContain('/login?wa=');
    expect(groupText).toContain('private link');
    expect(result.message).toContain('private link');
  });

  it('does nothing when the store type is not set', async () => {
    const { prisma } = makePrisma({ pending: [pendingRow(closePayload)] });
    const result = await handleWhatsAppCommand(prisma, PHONE, 'OK');
    expect(result.message).not.toContain('Sales:');
    expect(result.message).not.toContain('paid outs');
    expect(postToStoreGroups).not.toHaveBeenCalled();
  });
});

describe('STORE command', () => {
  it('still refuses the old link command, but not a store-sales caption', async () => {
    const { prisma } = makePrisma();
    const refused = await handleWhatsAppCommand(prisma, PHONE, 'STORE S001');
    expect(refused.success).toBe(false);
    expect(refused.message).toContain('disabled for security');
    expect(isWhatsAppCommand('store sales')).toBe(false);
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
    expect(result.message).toContain('Rockaway: deposit = card + cash + gas − payouts');
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

describe('invoice remaining', () => {
  it('recognises DUE as a command', () => {
    expect(isWhatsAppCommand('DUE')).toBe(true);
  });

  it('lists bills still owed', async () => {
    const { prisma } = makePrisma();
    (prisma.pendingActions.findMany as jest.Mock).mockResolvedValue([
      {
        actionId: 'inv-1',
        storeId: 'S001',
        payloadJson: {
          _kind: 'invoice',
          vendor: 'Pepsi',
          invoice: {
            vendorName: 'Pepsi',
            invoiceNumber: '88',
            invoiceDate: '2026-10-12',
            dueDate: '2026-10-28',
            lineItems: [],
            total: 900,
            paymentStatus: 'unpaid',
            remainingDue: 400,
            remainingMethod: 'check',
            payBy: '2026-10-17',
          },
        },
      },
    ]);
    const result = await handleWhatsAppCommand(prisma, PHONE, 'DUE');
    expect(result.success).toBe(true);
    expect(result.message).toContain('Pepsi #88');
    expect(result.message).toContain('$400 remaining check');
  });

  it('merges a payment OK onto the original invoice', async () => {
    const original = {
      actionId: 'inv-1',
      storeId: 'S001',
      type: 'INVOICE_EXPENSE',
      status: 'CONFIRMED',
      payloadJson: { _kind: 'invoice', vendor: 'Pepsi', invoice: { vendorName: 'Pepsi', total: 900, paymentStatus: 'unpaid', lineItems: [] } },
    };
    const payment = pendingRow(
      {
        _kind: 'invoice_payment',
        updates_action_id: 'inv-1',
        vendor: 'Pepsi',
        remaining: 400,
        invoice: {
          vendorName: 'Pepsi',
          invoiceNumber: '88',
          invoiceDate: '2026-10-12',
          dueDate: '2026-11-20',
          lineItems: [],
          total: 900,
          paymentStatus: 'unpaid',
          payments: [{ amount: 500, method: 'cash' }],
          remainingDue: 400,
          remainingMethod: 'check',
          payBy: '2026-11-20',
        },
      },
      'S001',
      'INVOICE_EXPENSE'
    );
    const { prisma } = makePrisma({ pending: [payment] });
    (prisma.pendingActions.findFirst as jest.Mock).mockImplementation(async ({ where }: { where: { actionId?: string } }) => {
      if (where.actionId === 'inv-1') return original;
      return payment;
    });
    const result = await handleWhatsAppCommand(prisma, PHONE, 'OK');
    expect(result.success).toBe(true);
    expect((prisma.pendingActions.update as jest.Mock).mock.calls[0][0].where).toEqual({ actionId: 'inv-1' });
    expect((prisma.pendingActions.update as jest.Mock).mock.calls[0][0].data.payloadJson.remaining).toBe(400);
    expect((prisma.pendingActions.update as jest.Mock).mock.calls[0][0].data.payloadJson._kind).toBe('invoice');
    expect((prisma.taskTemplate.create as jest.Mock).mock.calls[0][0].data.title).toContain('$400');
  });

  it('merges a later close page onto the original daily close', async () => {
    const original = {
      actionId: 'close-1',
      storeId: 'S001',
      type: 'STORE_SALES',
      status: 'CONFIRMED',
      payloadJson: {
        _kind: 'daily_close',
        report_date: '2026-11-07',
        fuel_sales: 6086.32,
        gallons: 1455.226,
        cash: 0,
        card: 0,
        report: {
          storeHint: 'Denville',
          reportDate: '2026-11-07',
          fuelSales: 6086.32,
          fuelGallons: 1455.226,
          storeSalesTotal: 0,
          cardSales: 0,
          cashSales: null,
          payouts: [],
        },
      },
    };
    const cashPage = pendingRow(
      {
        _kind: 'daily_close',
        updates_action_id: 'close-1',
        report_date: '2026-11-07',
        cash: 765.14,
        report: {
          storeHint: 'Denville',
          reportDate: '2026-11-07',
          cashSales: 765.14,
          payouts: [],
        },
      },
      'S001',
      'STORE_SALES'
    );
    cashPage.actionId = 'close-2';
    const { prisma } = makePrisma({ pending: [cashPage] });
    (prisma.pendingActions.findFirst as jest.Mock).mockImplementation(async ({ where }: { where: { actionId?: string } }) => {
      if (where.actionId === 'close-1') return original;
      return cashPage;
    });
    const result = await handleWhatsAppCommand(prisma, PHONE, 'OK');
    expect(result.success).toBe(true);
    const updates = (prisma.pendingActions.update as jest.Mock).mock.calls;
    expect(updates[0][0].where).toEqual({ actionId: 'close-1' });
    expect(updates[0][0].data.status).toBe('CONFIRMED');
    expect(updates[0][0].data.payloadJson.fuel_sales).toBe(6086.32);
    expect(updates[0][0].data.payloadJson.cash).toBe(765.14);
    expect(updates[0][0].data.payloadJson.gallons).toBe(1455.226);
    expect(updates[1][0].where).toEqual({ actionId: 'close-2' });
    expect(updates[1][0].data.status).toBe('CANCELLED');
    expect(prisma.pendingActions.updateMany).not.toHaveBeenCalled();
  });
});
