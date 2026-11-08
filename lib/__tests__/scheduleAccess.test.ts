import { sign } from 'jsonwebtoken';

const findFirst = jest.fn();
const findMany = jest.fn();
const storeFindUnique = jest.fn();
const directoryFindMany = jest.fn();
const userStoreFindMany = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: function PrismaClient() {
    return {
      userStore: { findFirst, findMany: userStoreFindMany },
      pendingActions: { findMany },
      storeConfig: { findUnique: storeFindUnique },
      userDirectory: { findMany: directoryFindMany, findFirst: jest.fn().mockResolvedValue(null) },
    };
  },
}));

import handler from '../../api/stores/data';

process.env.JWT_SECRET = 'test-secret';
const token = sign({ userId: 'u1', email: 'a@b.c' }, 'test-secret');

async function call(type: string) {
  let status = 200;
  let body: Record<string, unknown> = {};
  const res = {
    status(code: number) {
      status = code;
      return res;
    },
    json(payload: Record<string, unknown>) {
      body = payload;
      return res;
    },
  };
  await handler({ query: { storeId: 'S001', type }, headers: { authorization: `Bearer ${token}` } } as never, res as never);
  return { status, body };
}

const row = (kind: string, id: string) => ({ actionId: id, createdAt: new Date(), payloadJson: { _kind: kind }, confidence: 0.9 });

describe('Schedule tab data', () => {
  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([row('deposit_receipt', 'd1'), row('work_schedule', 's1'), row('work_schedule', 's2')]);
    storeFindUnique.mockReset().mockResolvedValue({ timezone: 'America/New_York', storeName: 'Rockaway' });
    directoryFindMany.mockReset().mockResolvedValue([]);
    userStoreFindMany.mockReset().mockResolvedValue([]);
  });

  it('is refused for staff', async () => {
    findFirst.mockResolvedValue({ role: 'STAFF' });
    const { status } = await call('schedules');
    expect(status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each(['OWNER', 'MANAGER'])('is allowed for %s and lists schedules only (not deposit slips)', async (role) => {
    findFirst.mockResolvedValue({ role });
    const { status, body } = await call('schedules');
    expect(status).toBe(200);
    expect((body.schedules as Array<{ id: string }>).map((r) => r.id)).toEqual(['s1', 's2']);
    expect(body.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.people).toEqual([]);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ storeId: 'S001', type: 'UNKNOWN', status: 'CONFIRMED' });
  });

  it('does not change what staff see on the other tabs', async () => {
    findFirst.mockResolvedValue({ role: 'STAFF' });
    findMany.mockResolvedValue([]);
    expect((await call('sales')).status).toBe(200);
  });
});

describe('Fuel Sales tab', () => {
  it('includes gas from a daily close, not only FUEL_SALES rows', async () => {
    findFirst.mockReset().mockResolvedValue({ role: 'OWNER' });
    findMany.mockReset().mockResolvedValue([
      {
        actionId: 'denville',
        type: 'STORE_SALES',
        createdAt: new Date('2026-11-08T01:47:00Z'),
        payloadJson: { _kind: 'daily_close', report_date: '2026-11-07', fuel_sales: 6086.32, gallons: 1455.226 },
        confidence: 0.9,
      },
    ]);
    const { status, body } = await call('fuel');
    expect(status).toBe(200);
    expect(findMany.mock.calls[0][0].where.type).toEqual({ in: ['FUEL_SALES', 'STORE_SALES'] });
    expect((body.fuel as Array<{ data: { fuel_sales: number } }>)[0].data.fuel_sales).toBe(6086.32);
  });
});
