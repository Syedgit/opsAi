import { buildStoreReport, fallbackReportInsights, reportWeekStart, resolveReportRange } from '../storeReport';

const TZ = 'America/New_York';

describe('store report range', () => {
  it('starts a normal week on Monday', () => {
    expect(reportWeekStart('2026-11-08', 'convenience')).toBe('2026-11-02');
  });

  it('starts a 7-Eleven week on Friday', () => {
    expect(reportWeekStart('2026-11-08', 'seven_eleven')).toBe('2026-11-06');
  });

  it('uses custom dates and swaps if they are backwards', () => {
    const range = resolveReportRange('custom', '2026-11-08', '2026-11-10', '2026-11-01');
    expect(range.from).toBe('2026-11-01');
    expect(range.to).toBe('2026-11-10');
    expect(range.period).toBe('custom');
  });
});

describe('store report totals', () => {
  it('rolls sales, buying, and till expenses onto the business day', () => {
    const report = buildStoreReport(
      [
        {
          type: 'STORE_SALES',
          createdAt: new Date('2026-11-09T04:00:00Z'),
          payloadJson: {
            _kind: 'daily_close',
            report_date: '2026-11-08',
            cash: 200,
            card: 800,
            total_inside: 1000,
            fuel_sales: 400,
            report: {
              storeHint: null,
              reportDate: '2026-11-08',
              cashSales: 200,
              cardSales: 800,
              storeSalesTotal: 1000,
              fuelSales: 400,
              payouts: [{ label: 'Lays', amount: 40 }],
              reportedDeposit: 1360,
            },
            deposit: 1360,
          },
        },
        {
          type: 'INVOICE_EXPENSE',
          createdAt: new Date('2026-11-08T18:00:00Z'),
          payloadJson: {
            _kind: 'invoice',
            vendor: 'Pepsi',
            amount: 184.2,
            invoice: { vendorName: 'Pepsi', total: 184.2, invoiceDate: '2026-11-08', lineItems: [{ description: 'soda', amount: 184.2 }] },
          },
        },
        {
          type: 'PAID_OUT',
          createdAt: new Date('2026-11-08T19:00:00Z'),
          payloadJson: { amount: 21, reason: 'ATM' },
        },
      ],
      { from: '2026-11-08', to: '2026-11-08', label: 'Nov 8', period: 'custom' },
      { storeId: 'S001', storeName: 'Rockaway', timeZone: TZ },
    );

    expect(report.totals.sales).toBe(1400);
    expect(report.totals.cash).toBe(200);
    expect(report.totals.card).toBe(800);
    expect(report.totals.fuel).toBe(400);
    expect(report.totals.buying).toBe(184.2);
    expect(report.totals.expenses).toBe(61);
    expect(report.totals.standing).toBe(1154.8);
    expect(report.totals.deposits).toBe(1360);
    expect(report.vendors[0]).toMatchObject({ vendor: 'Pepsi', amount: 184.2 });
    expect(report.days).toHaveLength(1);
  });

  it('does not add a typed test close on top of a POS day total', () => {
    const report = buildStoreReport(
      [
        {
          type: 'STORE_SALES',
          createdAt: new Date('2026-11-08T05:32:57Z'),
          payloadJson: { cash: 100, card: 200, total_inside: 300, raw_text: 'fake close' },
        },
        {
          type: 'STORE_SALES',
          createdAt: new Date('2026-11-08T23:53:12Z'),
          payloadJson: {
            _kind: 'daily_close',
            report_date: '2026-11-08',
            cash: 614.98,
            card: 1150.6,
            total_inside: 1765.58,
            report: { cashSales: 614.98, cardSales: 1150.6, periodClosed: false, payouts: [] },
          },
        },
      ],
      { from: '2026-11-08', to: '2026-11-08', label: 'Nov 8', period: 'custom' },
      { storeId: 'S002', storeName: 'Test-Store', timeZone: TZ },
    );
    expect(report.totals.cash).toBe(614.98);
    expect(report.totals.card).toBe(1150.6);
    expect(report.totals.sales).toBe(1765.58);
  });

  it('does not treat invoice cash as a second expense', () => {
    const report = buildStoreReport(
      [
        {
          type: 'INVOICE_EXPENSE',
          createdAt: new Date('2026-11-08T12:00:00Z'),
          payloadJson: {
            _kind: 'invoice',
            vendor: 'Pepsi',
            amount: 100,
            invoice: {
              vendorName: 'Pepsi',
              total: 100,
              invoiceDate: '2026-11-08',
              paymentStatus: 'paid_cash',
              lineItems: [{ description: 'soda', amount: 100 }],
            },
          },
        },
      ],
      { from: '2026-11-08', to: '2026-11-08', label: 'Nov 8', period: 'custom' },
      { storeId: 'S001', storeName: 'Rockaway', timeZone: TZ },
    );
    expect(report.totals.buying).toBe(100);
    expect(report.totals.expenses).toBe(0);
  });

  it('does not mention wages in the fallback copy', () => {
    const report = buildStoreReport(
      [],
      { from: '2026-11-02', to: '2026-11-08', label: 'week', period: 'week' },
      { storeId: 'S001', storeName: 'Rockaway', timeZone: TZ },
    );
    const copy = fallbackReportInsights(report);
    expect(copy.insights.join(' ')).not.toMatch(/wage|payroll|hourly/i);
    expect(copy.recommendations.join(' ')).not.toMatch(/wage|payroll|hourly/i);
  });
});
