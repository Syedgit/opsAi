import { proofChecks, storeForSheet, textOverPhoto } from '../closeSources';
import type { DailyCloseReport } from '../schema';

const blank: DailyCloseReport = {
  storeHint: null,
  reportDate: '2026-11-09',
  cardSales: null,
  cashSales: null,
  storeSalesTotal: null,
  fuelSales: null,
  fuelGallons: null,
  fuelDiscounts: null,
  payouts: [],
  reportedDeposit: null,
  reportedDayTotal: null,
  periodClosed: null,
};

const denvilleText = { ...blank, storeHint: 'Denville', cardSales: 0, fuelSales: 700, reportedDeposit: 700 };
const denvillePos = { ...blank, storeHint: 'Denville Exxon', fuelSales: 5188.19, fuelGallons: 1243.54, cashSales: 700.05, storeSalesTotal: 0, reportedDayTotal: 5186.96, periodClosed: false };
const rockawayText = { ...blank, storeHint: 'Rockaway', cardSales: 253, cashSales: 105, fuelSales: 1476, reportedDeposit: 1834 };
const sheet = { ...blank, cardSales: 253, cashSales: 105, storeSalesTotal: 358 };

describe('typed post with photo proof', () => {
  it('keeps the typed money and only takes gallons from the POS', () => {
    const record = textOverPhoto(denvilleText, denvillePos);
    expect(record.fuelSales).toBe(700);
    expect(record.cashSales).toBeNull();
    expect(record.fuelGallons).toBe(1243.54);
  });

  it('checks typed gas against the POS cash acceptor, within a dollar', () => {
    const [gas] = proofChecks(denvilleText, denvillePos);
    expect(gas).toMatchObject({ id: 'proof_gas_cash', status: 'pass' });
    const [off] = proofChecks({ ...denvilleText, fuelSales: 650 }, denvillePos);
    expect(off.status).toBe('warn');
    expect(off.message).toContain('recount');
  });

  it('checks a handwritten sheet against the typed credit and cash', () => {
    const checks = proofChecks(rockawayText, sheet);
    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ['proof_credit', 'pass'],
      ['proof_cash', 'pass'],
    ]);
  });

  it('finds the store for an unnamed sheet by its numbers', () => {
    const open = (storeId: string, report: DailyCloseReport) => ({ actionId: storeId, storeId, status: 'PENDING' as const, report });
    const closes = [open('S001', rockawayText), open('S002', denvilleText)];
    expect(storeForSheet(sheet, '2026-11-09', closes, ['S001', 'S002'])).toBe('S001');
    expect(storeForSheet({ ...sheet, cardSales: 999 }, '2026-11-09', closes, ['S001', 'S002'])).toBeNull();
  });
});
