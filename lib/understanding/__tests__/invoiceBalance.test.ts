import {
  applyPayments,
  describeBalance,
  looksLikePaymentUpdate,
  matchOpenInvoice,
  remainingOf,
  settleInvoice,
  stillDue,
  tillCashPayments,
} from '../invoiceBalance';
import { flattenTillPaidOuts, sourceActionId } from '../tillPaidOuts';
import type { Invoice } from '../schema';

const pepsi: Invoice = {
  vendorName: 'Pepsi',
  invoiceNumber: '88',
  invoiceDate: '2026-10-12',
  dueDate: '2026-10-28',
  lineItems: [],
  total: 900,
  paymentStatus: 'unpaid',
};

describe('settleInvoice', () => {
  it('treats paid cash + remaining as one bill', () => {
    const settled = settleInvoice({
      ...pepsi,
      remainingDue: 400,
      remainingMethod: 'check',
      payBy: '2026-10-17',
    });
    expect(settled.total).toBe(900);
    expect(settled.payments).toEqual([{ amount: 500, method: 'cash' }]);
    expect(settled.remainingDue).toBe(400);
    expect(settled.paymentStatus).toBe('unpaid');
    expect(stillDue(settled)).toBe(true);
    expect(tillCashPayments(settled)).toEqual([{ amount: 500, method: 'cash' }]);
  });

  it('infers the bill from paid + remaining when no original total was given', () => {
    const settled = settleInvoice({
      ...pepsi,
      total: 500,
      payments: [{ amount: 500, method: 'cash' }],
      remainingDue: 400,
    });
    expect(settled.total).toBe(900);
    expect(remainingOf(settled)).toBe(400);
  });

  it('marks a bill paid when remaining is zero', () => {
    const settled = settleInvoice({
      ...pepsi,
      payments: [{ amount: 900, method: 'cash' }],
      remainingDue: 0,
    });
    expect(stillDue(settled)).toBe(false);
    expect(settled.paymentStatus).toBe('paid_cash');
    expect(describeBalance(settled)).toBe('paid cash');
  });
});

describe('match and merge a later payment', () => {
  it('updates the open Pepsi bill and keeps check as how the rest will be paid', () => {
    const open = settleInvoice({ ...pepsi, paymentStatus: 'unpaid' });
    const incoming = settleInvoice({
      vendorName: 'Pepsi',
      invoiceNumber: null,
      invoiceDate: null,
      lineItems: [],
      total: 500,
      paymentStatus: 'unknown',
      payments: [{ amount: 500, method: 'cash' }],
      remainingDue: 400,
      remainingMethod: 'check',
      payBy: '2026-10-17',
    });
    expect(looksLikePaymentUpdate(incoming)).toBe(true);
    const hit = matchOpenInvoice(incoming, [{ actionId: 'a1', storeId: 'S001', invoice: open }], 'S001');
    expect(hit?.actionId).toBe('a1');
    const merged = applyPayments(open, incoming);
    expect(merged.remainingDue).toBe(400);
    expect(merged.remainingMethod).toBe('check');
    expect(merged.payBy).toBe('2026-10-17');
    expect(describeBalance(merged)).toContain('$400 still due');
  });

  it('does not treat a new unpaid invoice as a payment on another bill', () => {
    expect(looksLikePaymentUpdate(pepsi)).toBe(false);
  });
});

describe('flattenTillPaidOuts', () => {
  const day = new Date('2026-10-12T18:00:00Z');

  it('lists close payouts and invoice cash, not checks', () => {
    const rows = flattenTillPaidOuts([
      {
        actionId: 'close1',
        type: 'STORE_SALES',
        createdAt: day,
        confidence: 0.9,
        payloadJson: { _kind: 'daily_close', report: { payouts: [{ label: 'Lays', amount: 142 }] } },
      },
      {
        actionId: 'inv1',
        type: 'INVOICE_EXPENSE',
        createdAt: day,
        confidence: 0.9,
        payloadJson: {
          _kind: 'invoice',
          vendor: 'Pepsi',
          invoice: settleInvoice({ ...pepsi, remainingDue: 400, remainingMethod: 'check' }),
        },
      },
      {
        actionId: 'po1',
        type: 'PAID_OUT',
        createdAt: day,
        confidence: 0.9,
        payloadJson: { amount: 50, reason: 'ice from till' },
      },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.data)).toEqual(
      expect.arrayContaining([
        { amount: 142, reason: 'Lays', employee: 'N/A' },
        { amount: 500, reason: 'Pepsi cash', employee: 'N/A' },
        { amount: 50, reason: 'ice from till', employee: 'N/A' },
      ])
    );
    expect(sourceActionId('close1:payout:0')).toBe('close1');
  });
});
