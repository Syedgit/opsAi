import {
  isSheetConnected,
  monthTab,
  parseGoogleSheetId,
  rowsForConfirmedAction,
} from '../googleSheetsRows';

describe('parseGoogleSheetId', () => {
  it('reads id from a docs URL or raw id', () => {
    expect(
      parseGoogleSheetId('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0')
    ).toBe('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
    expect(parseGoogleSheetId('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms')).toBe(
      '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
    );
    expect(parseGoogleSheetId('pending_google_sheet')).toBeNull();
    expect(isSheetConnected('pending_google_sheet')).toBe(false);
    expect(isSheetConnected('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms')).toBe(true);
  });
});

describe('month tabs', () => {
  it('names the year tab from the report day', () => {
    expect(monthTab('2026-11-12')).toBe('2026-11');
    expect(monthTab('', '2026-12-01T12:00:00.000Z')).toBe('2026-12');
  });

  it('appends a daily close onto that month tab and paid outs beside it', () => {
    const rows = rowsForConfirmedAction(
      'STORE_SALES',
      {
        _kind: 'daily_close',
        report_date: '2026-11-12',
        cash: 152,
        card: 900,
        total_inside: 1052,
        fuel_sales: 4000,
        gallons: 900.5,
        deposit: 1200,
        report: { payouts: [{ label: 'Lays', amount: 42 }] },
        needs_review: ['cashSales'],
      },
      { storeId: 'S009', storeName: 'Denville', confidence: 0.9 }
    );
    expect(rows.map((r) => r.tab)).toEqual(['2026-11', '2026-11 Paid outs']);
    expect(rows[0].row).toEqual(
      expect.arrayContaining(['2026-11-12', 'Denville', 'S009', 152, 900, 1052, 4000, 900.5, 42, 1200])
    );
    expect(String(rows[0].row[10])).toContain('cash');
    expect(rows[1].row[4]).toBe('Lays');
  });

  it('puts invoices on the month invoices tab', () => {
    const rows = rowsForConfirmedAction(
      'INVOICE_EXPENSE',
      {
        _kind: 'invoice',
        vendor: 'HLA',
        invoice_number: '99',
        amount: 500,
        paid: 'N',
        remaining: 500,
        invoice_date: '2026-11-10',
        due_date: '2026-11-20',
      },
      { storeId: 'S001', storeName: 'Rockaway' }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tab).toBe('2026-11 Invoices');
    expect(rows[0].row).toEqual(
      expect.arrayContaining(['2026-11-10', 'Rockaway', 'S001', 'HLA', '99', 500, 'N', 500, '2026-11-20'])
    );
  });
});
