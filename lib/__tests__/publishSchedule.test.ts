import { publishDashboardSchedule } from '../publishSchedule';

describe('publishDashboardSchedule', () => {
  it('rejects a week with no named shifts', async () => {
    const prisma = {} as never;
    const result = await publishDashboardSchedule(prisma, {
      storeId: 'S001',
      storeName: 'Harbor UPS',
      phoneE164: '+15550100000',
      weekStart: '2026-11-01',
      employees: [{ name: 'Alex', shifts: [] }],
    });
    expect(result).toEqual({ ok: false, status: 400, error: 'Add at least one person with a start and end time.' });
  });
});
