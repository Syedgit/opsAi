import {
  businessDayOf,
  collectPaidOuts,
  formatDaySummary,
  summaryKindForStore,
  type DayActivity,
} from '../daySummary';

const close = {
  type: 'STORE_SALES',
  payload: {
    _kind: 'daily_close',
    cash: 106,
    card: 334,
    fuel_sales: 1355,
    deposit: 1653,
    report: { payouts: [{ label: 'Lays', amount: 142 }] },
  },
};

const invoice = {
  type: 'INVOICE_EXPENSE',
  payload: { _kind: 'invoice', vendor: 'Pepsi', amount: 184.2, invoice: { paymentStatus: 'paid_cash' } },
};

const paidOut = { type: 'PAID_OUT', payload: { amount: 50, reason: 'ice from till' } };

describe('summaryKindForStore', () => {
  it('wraps the whole day when a non-7-Eleven store confirms the close', () => {
    expect(summaryKindForStore('convenience', [close])).toBe('store_day');
    expect(summaryKindForStore('gas_station', [close])).toBe('store_day');
  });

  it('only totals paid-outs for a 7-Eleven', () => {
    expect(summaryKindForStore('seven_eleven', [close])).toBe('paid_outs');
    expect(summaryKindForStore('seven_eleven', [paidOut])).toBe('paid_outs');
  });

  it('does nothing until the store type is set', () => {
    expect(summaryKindForStore(null, [close])).toBeNull();
    expect(summaryKindForStore('convenience', [invoice])).toBeNull();
  });
});

describe('formatDaySummary', () => {
  it('posts a short non-7-Eleven wrap-up of sales, paid-outs and invoices', () => {
    const activity: DayActivity = {
      storeName: 'Corner',
      day: '2026-10-12',
      kind: 'store_day',
      rows: [close, invoice],
      inspection: { percent: 92 },
    };
    const text = formatDaySummary(activity);
    expect(text).toContain('📋 Corner · Mon, Oct 12');
    expect(text).toContain('Sales: cash $106 · card $334 · gas $1,355');
    expect(text).toContain('Paid out: Lays $142');
    expect(text).toContain('Invoices: Pepsi $184.20 paid cash');
    expect(text).toContain('Deposit $1,653');
    expect(text).toContain('Inspection 92%');
    expect(text).not.toMatch(/salary|wage|payroll|hourly/i);
  });

  it('for 7-Eleven only lists till paid-outs as written, never pay', () => {
    const activity: DayActivity = {
      storeName: 'Rockaway',
      day: '2026-10-12',
      kind: 'paid_outs',
      rows: [close, paidOut],
      inspection: null,
    };
    const text = formatDaySummary(activity);
    expect(text).toBe(
      ['💸 Rockaway · paid outs Mon, Oct 12', '• Lays $142', '• ice from till $50', 'Total $192'].join('\n')
    );
    expect(text).not.toMatch(/salary|wage|\$18/i);
  });
});

describe('collectPaidOuts', () => {
  it('keeps the sender label and does not invent a salary line', () => {
    expect(collectPaidOuts([paidOut])).toEqual([{ label: 'ice from till', amount: 50 }]);
  });

  it('repeats "salary paidout" only when the sender wrote that label', () => {
    expect(
      collectPaidOuts([
        {
          type: 'STORE_SALES',
          payload: {
            _kind: 'daily_close',
            report: { payouts: [{ label: 'salary paidout', amount: 200 }] },
          },
        },
      ])
    ).toEqual([{ label: 'salary paidout', amount: 200 }]);
  });
});

describe('businessDayOf', () => {
  it('uses the close date, not the morning they confirmed it', () => {
    expect(
      businessDayOf(
        [{ type: 'STORE_SALES', payload: { _kind: 'daily_close', report_date: '2026-10-12' } }],
        new Date('2026-10-13T16:00:00Z'),
        'America/New_York'
      )
    ).toBe('2026-10-12');
  });
});
