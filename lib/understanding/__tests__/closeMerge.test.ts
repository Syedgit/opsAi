import { applyStoreCredit, matchOpenClose, mergeCloseReports, mergeDailyCloseReports, openCloseFromAction } from '../closeMerge';
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

  it('keeps screenshot gas when the typed close disagrees, and flags it', () => {
    const typed = { ...cashPage, fuelSales: 6100, reportedDeposit: 6800 };
    const { report, mismatches } = mergeCloseReports(fuelPage, typed);
    expect(report.fuelSales).toBe(6086.32);
    expect(report.cashSales).toBe(765.14);
    expect(report.reportedDeposit).toBe(6800);
    expect(mismatches.find((c) => c.id === 'screenshot_gas')?.status).toBe('fail');
    expect(mismatches.find((c) => c.id === 'screenshot_deposit')).toBeUndefined();
  });

  it('confirms gas when the text matches the screenshot', () => {
    const typed = { ...cashPage, fuelSales: 6086.32 };
    const { report, mismatches } = mergeCloseReports(fuelPage, typed);
    expect(report.fuelSales).toBe(6086.32);
    expect(mismatches.find((c) => c.id === 'screenshot_gas')?.status).toBe('pass');
  });

  it('keeps screenshot deposit when the typed close disagrees', () => {
    const screen = { ...fuelPage, reportedDeposit: 1653 };
    const { report, mismatches } = mergeCloseReports(screen, { ...cashPage, reportedDeposit: 1700 });
    expect(report.reportedDeposit).toBe(1653);
    expect(mismatches.find((c) => c.id === 'screenshot_deposit')?.status).toBe('fail');
  });
});

describe('handwritten credit against the POS', () => {
  const sheet: DailyCloseReport = {
    storeHint: 'Denville',
    reportDate: '2026-11-09',
    cardSales: 253,
    cashSales: 105,
    storeSalesTotal: 358,
    fuelSales: 0,
    fuelGallons: null,
    fuelDiscounts: null,
    payouts: [],
    reportedDeposit: null,
    reportedDayTotal: null,
    periodClosed: null,
  };

  it('keeps the POS non-fuel and cash, and says when the sheet credit matches', () => {
    const { report, mismatches } = mergeCloseReports(sheet, { ...fuelPage, storeSalesTotal: 253, cardSales: null, cashSales: 700.05 });
    expect(report.cardSales).toBe(253);
    expect(report.cashSales).toBe(700.05);
    expect(mismatches.find((c) => c.id === 'written_credit')?.status).toBe('pass');
  });

  it('flags a sheet credit that differs from the POS non-fuel', () => {
    const { mismatches } = mergeCloseReports(sheet, { ...fuelPage, storeSalesTotal: 300, cardSales: null });
    expect(mismatches.find((c) => c.id === 'written_credit')?.message).toContain('vs handwritten credit $253.00');
  });

  it('keeps the sheet inside sales when the fuel POS shows $0 non-fuel, through later pages', () => {
    const gasOnly = { ...fuelPage, reportDate: '2026-11-09', storeSalesTotal: 0, reportedDayTotal: 5186.96 };
    const first = mergeCloseReports(sheet, gasOnly);
    expect(first.report.cardSales).toBe(253);
    expect(first.report.storeSalesTotal).toBe(358);
    expect(first.report.reportedDayTotal).toBeNull();
    expect(first.insideFromSheet).toBe(true);
    expect(first.mismatches.some((c) => c.id === 'written_credit')).toBe(false);
    const tender = { ...cashPage, reportDate: '2026-11-09', cashSales: 700.05, cardSales: 80, reportedDayTotal: 5186.96, periodClosed: false };
    const second = mergeCloseReports(first.report, tender, { insideFromSheet: true });
    expect(second.report.cardSales).toBe(253);
    expect(second.report.cashSales).toBe(700.05);
    expect(second.report.reportedDayTotal).toBeNull();
  });

  it('does not let a sheet sent after the screen overwrite the POS cash', () => {
    const screen = { ...fuelPage, storeSalesTotal: 253, cardSales: null, cashSales: 700.05 };
    const { report } = mergeCloseReports(screen, sheet);
    expect(report.cashSales).toBe(700.05);
  });
});

describe('loadOpenCloses date fallback', () => {
  it('keeps a typed close with no report date so a later POS screen can merge', () => {
    const close = openCloseFromAction({
      actionId: 'fake-1',
      storeId: 'S002',
      status: 'CONFIRMED',
      payloadJson: { cash: 100, card: 200, total_inside: 300 },
    });
    expect(close?.report.cashSales).toBe(100);
    expect(close?.report.reportDate).toBeNull();
  });
});

describe('matchOpenClose', () => {
  it('matches the same store and report date', () => {
    const open = { actionId: 'close-1', storeId: 'S002', status: 'CONFIRMED' as const, report: fuelPage };
    expect(matchOpenClose('S002', '2026-11-07', [open])?.actionId).toBe('close-1');
    expect(matchOpenClose('S001', '2026-11-07', [open])).toBeNull();
    expect(matchOpenClose('S002', '2026-11-06', [open])).toBeNull();
    expect(matchOpenClose('S002', null, [open], ['2026-11-07', '2026-11-06'])?.actionId).toBe('close-1');
    expect(matchOpenClose('S002', null, [open], ['2026-11-08'])).toBeNull();
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
