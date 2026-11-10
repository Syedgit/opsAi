import {
  coverLabel,
  depositNudgeMinutes,
  eventsFromRows,
  expectedDepositAmount,
  foldDepositBag,
  formatBagLine,
  formatDepositDue,
  formatSlipResult,
  isDepositStoreType,
  reportFromClosePayload,
} from '../depositDue';
import { defaultSetup } from '../../tasks/storeSetup';
import type { DailyCloseReport } from '../schema';

const rule = { includeCardSales: true, includeFuelSales: true, subtractPayouts: true, floatLeftInRegister: 0 };

const closePayload = (date: string, deposit = 1653) => ({
  _kind: 'daily_close',
  cash: 106,
  card: 334,
  fuel_sales: 1355,
  deposit,
  report_date: date,
  report: {
    storeHint: 'Rockaway',
    reportDate: date,
    cardSales: 334,
    cashSales: 106,
    fuelSales: 1355,
    payouts: [{ label: 'Lays', amount: 142 }],
    reportedDeposit: deposit,
  },
});

const closeRow = (date: string, deposit = 1653) => ({
  type: 'STORE_SALES',
  payload: closePayload(date, deposit),
});

const slipRow = (date: string, amount: number) => ({
  type: 'UNKNOWN',
  payload: { _kind: 'deposit_receipt', amount, deposit_date: date },
});

describe('expectedDepositAmount', () => {
  const report = closePayload('2026-10-12').report as DailyCloseReport;

  it('uses the learned rule when the store has one', () => {
    expect(expectedDepositAmount(report, rule)).toBe(1653);
  });

  it('falls back to the figure they wrote when that figure adds up', () => {
    expect(expectedDepositAmount(report, null)).toBe(1653);
  });

  it('ignores a written deposit that does not add up and uses the sales instead', () => {
    expect(
      expectedDepositAmount(
        {
          storeHint: 'Danville',
          reportDate: '2026-11-06',
          cardSales: 0,
          cashSales: 0,
          fuelSales: 661,
          payouts: [{ label: 'Umar', amount: 220 }],
          reportedDeposit: 6611,
        },
        null
      )
    ).toBe(441);
  });
});

describe('foldDepositBag', () => {
  it('asks for yesterday\'s close until a bank slip shows up', () => {
    const events = eventsFromRows([closeRow('2026-10-12')], rule, 'America/New_York');
    const morning = foldDepositBag(events, '2026-10-13');
    expect(morning.remaining).toBe(1653);
    expect(morning.days).toEqual([{ day: '2026-10-12', amount: 1653 }]);
    expect(foldDepositBag(events, '2026-10-12').remaining).toBe(0);
  });

  it('keeps adding days when no slip is in the chat', () => {
    const events = eventsFromRows(
      [closeRow('2026-10-12'), closeRow('2026-10-13')],
      rule,
      'America/New_York'
    );
    const bag = foldDepositBag(events, '2026-10-14');
    expect(bag.remaining).toBe(3306);
    expect(coverLabel(bag.days)).toBe('Mon, Oct 12 – Tue, Oct 13');
  });

  it('clears the bag when a slip covers the running total', () => {
    const events = eventsFromRows(
      [closeRow('2026-10-12'), closeRow('2026-10-13'), slipRow('2026-10-14', 3306)],
      rule,
      'America/New_York'
    );
    expect(foldDepositBag(events, '2026-10-15').remaining).toBe(0);
  });

  it('pays off the oldest day first when the slip is partial', () => {
    const events = eventsFromRows(
      [closeRow('2026-10-12'), closeRow('2026-10-13'), slipRow('2026-10-14', 1653)],
      rule,
      'America/New_York'
    );
    const bag = foldDepositBag(events, '2026-10-15');
    expect(bag).toEqual({ remaining: 1653, days: [{ day: '2026-10-13', amount: 1653 }] });
  });

  it('includes today\'s close after they post sales', () => {
    const events = eventsFromRows([closeRow('2026-10-12')], rule, 'America/New_York');
    expect(foldDepositBag(events, '2026-10-12', { includeTodayCloses: true }).remaining).toBe(1653);
  });

  it('does not add a typed test close on top of a POS day total', () => {
    const events = eventsFromRows(
      [
        { type: 'STORE_SALES', payload: { cash: 100, card: 200, total_inside: 300 }, createdAt: new Date('2026-11-08T05:32:57Z') },
        {
          type: 'STORE_SALES',
          payload: {
            _kind: 'daily_close',
            cash: 614.98,
            card: 1150.6,
            report_date: '2026-11-08',
            report: { cashSales: 614.98, cardSales: 1150.6, periodClosed: false, payouts: [] },
          },
          createdAt: new Date('2026-11-08T23:53:12Z'),
        },
      ],
      rule,
      'America/New_York'
    );
    expect(foldDepositBag(events, '2026-11-08', { includeTodayCloses: true }).remaining).toBe(1765.58);
  });
});

describe('formatDepositDue', () => {
  it('writes a short morning note and never mentions pay', () => {
    const text = formatDepositDue('Rockaway', {
      remaining: 1653,
      days: [{ day: '2026-10-12', amount: 1653 }],
    });
    expect(text).toContain('🏦 Rockaway · deposit due');
    expect(text).toContain('$1,653 to take to the bank');
    expect(text).toContain('Covering Mon, Oct 12');
    expect(text).toContain('keep adding until you deposit');
    expect(text).not.toMatch(/salary|wage|payroll|hourly/i);
  });
});

describe('formatBagLine / slip result', () => {
  it('says the bag is clear after a covering slip', () => {
    expect(formatSlipResult({ remaining: 0, days: [] })).toBe('🏦 Bank slip saved. Deposit bag is clear.');
  });

  it('keeps the leftover after a partial slip', () => {
    expect(formatBagLine({ remaining: 1653, days: [{ day: '2026-10-13', amount: 1653 }] })).toContain(
      'To deposit: $1,653 covering Tue, Oct 13'
    );
  });

  it('shows today on its own and lists earlier days still not deposited', () => {
    const text = formatBagLine(
      { remaining: 6444.32, days: [{ day: '2026-11-07', amount: 6086.32 }, { day: '2026-11-09', amount: 358 }] },
      '2026-11-09'
    );
    expect(text).toContain('🏦 Deposit today: $358');
    expect(text).toContain('• Sat, Nov 7: $6,086.32');
    expect(text).toContain('Total to the bank: $6,444.32');
  });
});

describe('store type and morning hour', () => {
  it('only runs for non-7-Eleven stores that have a type', () => {
    expect(isDepositStoreType('convenience')).toBe(true);
    expect(isDepositStoreType('gas_station')).toBe(true);
    expect(isDepositStoreType('other')).toBe(true);
    expect(isDepositStoreType('seven_eleven')).toBe(false);
    expect(isDepositStoreType(null)).toBe(false);
  });

  it('does not nudge before 8am, even if the store opened earlier', () => {
    expect(depositNudgeMinutes(defaultSetup('convenience'))).toBe(8 * 60);
    expect(depositNudgeMinutes(defaultSetup('seven_eleven'))).toBe(8 * 60);
  });
});

describe('reportFromClosePayload', () => {
  it('reads the structured report, then the dashboard fields', () => {
    expect(reportFromClosePayload(closePayload('2026-10-12'))?.cashSales).toBe(106);
    expect(reportFromClosePayload({ _kind: 'daily_close', cash: 50, card: 10, deposit: 50, report_date: '2026-10-12' })?.cashSales).toBe(
      50
    );
  });
});
