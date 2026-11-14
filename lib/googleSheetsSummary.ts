import type { StoreReport } from './storeReport';

const SUMMARY_TAB = 'Summary';

export function summaryTabName(): string {
  return SUMMARY_TAB;
}

/**
 * One Summary tab for the store: overwritten with current month totals (not appended).
 * Same numbers the dashboard report uses — sales, buying, expenses, standing.
 */
export function summarySheetGrid(
  report: StoreReport,
  meta: { updatedAt?: Date } = {}
): (string | number)[][] {
  const t = report.totals;
  const updated = (meta.updatedAt ?? new Date()).toISOString();
  const rows: (string | number)[][] = [
    ['Field', 'Value'],
    ['Store', report.storeName],
    ['Store ID', report.storeId],
    ['Updated at', updated],
    ['Period', report.label],
    ['From', report.from],
    ['To', report.to],
    ['', ''],
    ['Sales (inside + gas on closes)', t.sales],
    ['Cash', t.cash],
    ['Card', t.card],
    ['Gas sales', t.fuel],
    ['Gallons', t.gallons],
    ['Buying (vendor invoices)', t.buying],
    ['Till expenses / paid outs', t.expenses],
    ['Deposits (from closes)', t.deposits],
    ['Standing (sales − buying − expenses)', t.standing],
    ['Closes posted', t.closes],
    ['Invoices posted', t.invoices],
    ['Days missing a close', t.missingCloses],
    ['', ''],
    ['Top vendors this period', 'Amount'],
  ];
  for (const v of report.vendors.slice(0, 8)) {
    rows.push([v.vendor, v.amount]);
  }
  if (report.vendors.length === 0) {
    rows.push(['—', '']);
  }
  rows.push(['', '']);
  rows.push(['Note', report.note]);
  return rows;
}
