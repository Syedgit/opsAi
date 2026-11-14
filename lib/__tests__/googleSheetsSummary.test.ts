import { summarySheetGrid, summaryTabName } from '../googleSheetsSummary';
import type { StoreReport } from '../storeReport';

const report: StoreReport = {
  storeId: 'S001',
  storeName: 'Rockaway',
  from: '2026-11-01',
  to: '2026-11-14',
  label: 'November 2026',
  period: 'month',
  totals: {
    sales: 10000,
    cash: 2000,
    card: 3000,
    fuel: 5000,
    gallons: 1200,
    buying: 1500,
    expenses: 200,
    deposits: 1800,
    standing: 8300,
    closes: 12,
    invoices: 4,
    missingCloses: 2,
  },
  days: [],
  vendors: [
    { vendor: 'HLA', amount: 900, count: 2 },
    { vendor: 'Lays', amount: 600, count: 2 },
  ],
  note: 'Not profit.',
};

describe('summarySheetGrid', () => {
  it('builds one Summary tab with current month standing', () => {
    expect(summaryTabName()).toBe('Summary');
    const grid = summarySheetGrid(report, { updatedAt: new Date('2026-11-14T20:00:00.000Z') });
    expect(grid[0]).toEqual(['Field', 'Value']);
    expect(grid.find((r) => r[0] === 'Store')).toEqual(['Store', 'Rockaway']);
    expect(grid.find((r) => r[0] === 'Standing (sales − buying − expenses)')).toEqual([
      'Standing (sales − buying − expenses)',
      8300,
    ]);
    expect(grid.find((r) => r[0] === 'HLA')).toEqual(['HLA', 900]);
    expect(grid.find((r) => r[0] === 'Note')?.[1]).toContain('Not profit');
  });
});
