import { settleInvoice } from '../invoiceBalance';
import {
  businessDayOf,
  cashAfterTillPaidOuts,
  collectPaidOuts,
  extraTillForDay,
  formatDaySummary,
  summaryKindForStore,
  tillCashItemsFromRows,
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

const proveedora = {
  type: 'INVOICE_EXPENSE',
  payload: {
    _kind: 'invoice',
    vendor: 'LA PROVEEDORA LATINA LLC',
    amount: 1061.53,
    invoice_date: '2026-10-12',
    invoice: settleInvoice({
      vendorName: 'LA PROVEEDORA LATINA LLC',
      invoiceNumber: '200242668',
      invoiceDate: '2026-10-12',
      storeHint: 'Rockaway',
      lineItems: [],
      total: 1061.53,
      paymentStatus: 'paid_cash',
    }),
  },
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
    expect(summaryKindForStore('seven_eleven', [proveedora])).toBe('paid_outs');
  });

  it('does nothing until the store type is set', () => {
    expect(summaryKindForStore(null, [close])).toBeNull();
    expect(summaryKindForStore('convenience', [invoice])).toBeNull();
  });
});

describe('formatDaySummary', () => {
  it('uses the POS screen, not an earlier typed test close, for cash and card', () => {
    const activity: DayActivity = {
      storeName: 'Test-Store',
      day: '2026-11-08',
      kind: 'store_day',
      rows: [
        { type: 'STORE_SALES', payload: { cash: 100, card: 200, total_inside: 300, raw_text: 'fake close' } },
        {
          type: 'STORE_SALES',
          payload: {
            _kind: 'daily_close',
            cash: 614.98,
            card: 1150.6,
            report: { cashSales: 614.98, cardSales: 1150.6, periodClosed: false, payouts: [] },
          },
        },
      ],
      inspection: null,
    };
    const text = formatDaySummary(activity);
    expect(text).toContain('cash $614.98');
    expect(text).toContain('card $1,150.60');
    expect(text).not.toContain('$714.98');
    expect(text).not.toContain('$1,350.60');
  });

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
    expect(text).toContain('Sales: inside cash $106 · inside card $334 · gas $1,355');
    expect(text).toContain('Paid out: Lays $142');
    expect(text).toContain('Cash after paid-outs -$36');
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
      [
        '💸 Rockaway · paid outs Mon, Oct 12',
        '• Lays $142',
        '• ice from till $50',
        'Total $192',
        'Cash $106 − paid outs $192 = -$86',
      ].join('\n')
    );
    expect(text).not.toMatch(/salary|wage|\$18/i);
  });

  it('subtracts invoice cash from leftover on a non-7-Eleven wrap-up', () => {
    const activity: DayActivity = {
      storeName: 'Rockaway',
      day: '2026-10-12',
      kind: 'store_day',
      rows: [{ ...close, payload: { ...close.payload, cash: 2500 } }, proveedora],
      inspection: null,
    };
    const text = formatDaySummary(activity);
    expect(text).toContain('Paid out: Lays $142, LA PROVEEDORA LATINA LLC cash $1,061.53');
    expect(text).toContain('Cash after paid-outs $1,296.47');
  });

  it('subtracts a cash-paid invoice from Rockaway cash at end of day', () => {
    const activity: DayActivity = {
      storeName: 'Rockaway',
      day: '2026-10-12',
      kind: 'paid_outs',
      rows: [{ ...close, payload: { ...close.payload, cash: 2500 } }, proveedora],
      inspection: null,
    };
    const text = formatDaySummary(activity);
    expect(text).toContain('• Lays $142');
    expect(text).toContain('• LA PROVEEDORA LATINA LLC cash $1,061.53');
    expect(text).toContain('Cash $2,500 − paid outs $1,203.53 = $1,296.47');
    expect(cashAfterTillPaidOuts(activity.rows)).toBe(1296.47);
  });
});

describe('collectPaidOuts', () => {
  it('keeps the sender label and does not invent a salary line', () => {
    expect(collectPaidOuts([paidOut])).toEqual([{ label: 'ice from till', amount: 50 }]);
  });

  it('counts cash on a vendor invoice as till money out', () => {
    expect(collectPaidOuts([proveedora])).toEqual([
      { label: 'LA PROVEEDORA LATINA LLC cash', amount: 1061.53 },
    ]);
  });

  it('skips a later payment update so the original invoice is not counted twice', () => {
    expect(
      collectPaidOuts([
        proveedora,
        {
          type: 'INVOICE_EXPENSE',
          payload: { _kind: 'invoice_payment', vendor: 'LA PROVEEDORA LATINA LLC', invoice: proveedora.payload.invoice },
        },
      ])
    ).toEqual([{ label: 'LA PROVEEDORA LATINA LLC cash', amount: 1061.53 }]);
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

describe('tillCashItemsFromRows', () => {
  it('keeps invoice cash on the invoice date so a later close can subtract it', () => {
    const items = tillCashItemsFromRows(
      [
        {
          storeId: 'S001',
          type: 'INVOICE_EXPENSE',
          payloadJson: proveedora.payload,
          createdAt: new Date('2026-10-12T18:00:00Z'),
        },
      ],
      'America/New_York'
    );
    expect(items).toEqual([
      { storeId: 'S001', label: 'LA PROVEEDORA LATINA LLC cash', amount: 1061.53, day: '2026-10-12' },
    ]);
    expect(extraTillForDay(items, 'S001', '2026-10-12')).toEqual([
      { label: 'LA PROVEEDORA LATINA LLC cash', amount: 1061.53 },
    ]);
    expect(extraTillForDay(items, 'S001', '2026-10-13')).toEqual([]);
    expect(extraTillForDay(items, 'S002', '2026-10-12')).toEqual([]);
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

describe('end-of-day summary for owners and managers', () => {
  it('uses the typed post labels and lists missed tasks by name', () => {
    const text = formatDaySummary(
      {
        storeName: 'Rockaway',
        day: '2026-11-09',
        kind: 'store_day',
        inspection: null,
        tasks: { done: 5, late: 1, missed: ['Clean restroom'], open: 0 },
        rows: [
          {
            type: 'STORE_SALES',
            payload: { _kind: 'daily_close', report_date: '2026-11-09', card: 253, cash: 105, fuel_sales: 1476, deposit: 1834, text_report: {} },
          },
        ],
      },
      { withDepositBag: true }
    );
    expect(text).toContain('📋 Rockaway · Mon, Nov 9 — end of day');
    expect(text).toContain('💰 Sales: store credit $253 · store cash $105 · gas cash $1,476');
    expect(text).toContain('⚠️ Tasks: 5 done · 1 late · 1 missed — missed: Clean restroom');
    expect(text).not.toContain('Deposit $1,834');
  });
});
