/**
 * A POS "Today" terminal report is the day's sales. Do not add leftover typed test
 * closes or extra pages on top of it.
 */

export type SalesPickRow = {
  type?: string;
  payload?: Record<string, unknown>;
  payloadJson?: unknown;
};

function payloadOf(row: SalesPickRow): Record<string, unknown> {
  if (row.payload && typeof row.payload === 'object') return row.payload;
  const json = row.payloadJson;
  return json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
}

function isDailyClose(payload: Record<string, unknown>): boolean {
  return payload._kind === 'daily_close';
}

function isPosDayTotal(payload: Record<string, unknown>): boolean {
  const report = payload.report && typeof payload.report === 'object' ? (payload.report as Record<string, unknown>) : null;
  if (!report) return false;
  return report.periodClosed != null || report.fuelGallons != null || report.fuelDiscounts != null || report.reportedDayTotal != null;
}

export function pickDaySalesRows<T extends SalesPickRow>(rows: T[]): T[] {
  const sales = rows.filter((row) => {
    const payload = payloadOf(row);
    return row.type === 'STORE_SALES' || payload._kind === 'daily_close';
  });
  if (sales.length <= 1) return sales;
  const structured = sales.filter((row) => isDailyClose(payloadOf(row)));
  const pool = structured.length > 0 ? structured : sales;
  const pos = pool.filter((row) => isPosDayTotal(payloadOf(row)));
  return pos.length > 0 ? [pos[pos.length - 1]] : pool;
}
