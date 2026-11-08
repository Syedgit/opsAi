import { applyStoreCredit, matchOpenClose, mergeDailyCloseReports, openCloseFromAction } from '../closeMerge';
import type { DailyCloseReport } from '../schema';

const fuelPage: DailyCloseReport = {
  storeHint: 'Denville Exxon',
  reportDate: '2026-11-07',
  cardSales: null,
  cashSales: null,
  storeSalesTotal: 0,
  fuelSales: 6086.32,
  fuelGallons: 1455.226,
  fuelDiscounts: 2.84,
  payouts: [],
  reportedDeposit: null,
  reportedDayTotal: null,
  periodClosed: false,
};

const cashPage: DailyCloseReport = {
  storeHint: 'Denville Exxon',
  reportDate: '2026-11-07',
  cardSales: null,
  cashSales: 765.14,
  storeSalesTotal: null,
  fuelSales: null,
  fuelGallons: null,
  fuelDiscounts: null,
  payouts: [],
  reportedDeposit: null,
  reportedDayTotal: null,
  periodClosed: null,
};

describe('applyStoreCredit', () => {
  it('copies Total Non Fuel Sales onto card when card was not its own line', () => {
    expect(applyStoreCredit(fuelPage).cardSales).toBe(0);
  });

  it('leaves an explicit card amount alone', () => {
    expect(applyStoreCredit({ ...fuelPage, cardSales: 42, storeSalesTotal: 99 }).cardSales).toBe(42);
  });
});

describe('mergeDailyCloseReports', () => {
  it('keeps gallons and fuel from the first page and cash from the tender page', () => {
    const merged = mergeDailyCloseReports(fuelPage, cashPage);
    expect(merged.fuelSales).toBe(6086.32);
    expect(merged.fuelGallons).toBe(1455.226);
    expect(merged.cashSales).toBe(765.14);
    expect(merged.cardSales).toBe(0);
    expect(merged.storeSalesTotal).toBe(0);
  });

  it('does not drop existing payouts when the later page has none', () => {
    const withPayout = { ...fuelPage, payouts: [{ label: 'Lays', amount: 12 }] };
    expect(mergeDailyCloseReports(withPayout, cashPage).payouts).toEqual([{ label: 'Lays', amount: 12 }]);
  });
});

describe('matchOpenClose', () => {
  it('matches the same store and report date', () => {
    const open = { actionId: 'close-1', storeId: 'S002', status: 'CONFIRMED' as const, report: fuelPage };
    expect(matchOpenClose('S002', '2026-11-07', [open])?.actionId).toBe('close-1');
    expect(matchOpenClose('S001', '2026-11-07', [open])).toBeNull();
    expect(matchOpenClose('S002', '2026-11-06', [open])).toBeNull();
  });
});

describe('openCloseFromAction', () => {
  it('reads a saved daily close payload', () => {
    const close = openCloseFromAction({
      actionId: 'close-1',
      storeId: 'S002',
      status: 'CONFIRMED',
      payloadJson: { _kind: 'daily_close', report: fuelPage, report_date: '2026-11-07' },
    });
    expect(close?.report.fuelSales).toBe(6086.32);
    expect(close?.report.reportDate).toBe('2026-11-07');
  });
});
