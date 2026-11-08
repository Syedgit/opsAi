/**
 * Fuel Sales tab: dedicated FUEL_SALES rows, plus daily closes that already have gas totals
 * (Invenco/Gilbarco Store Close photos are STORE_SALES with fuel_sales on the payload).
 */

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export type FuelFigures = {
  sales: number;
  gallons: number | null;
  gp: number | null;
  reportDate: string | null;
};

export function fuelFigures(payload: unknown): FuelFigures | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const report = p.report && typeof p.report === 'object' ? (p.report as Record<string, unknown>) : null;
  const sales = num(p.fuel_sales) ?? num(report?.fuelSales) ?? 0;
  const gallons = num(p.gallons) ?? num(report?.fuelGallons);
  const gp = num(p.fuel_gp);
  const reportDate =
    typeof p.report_date === 'string'
      ? p.report_date
      : typeof report?.reportDate === 'string'
        ? report.reportDate
        : null;
  if (sales <= 0 && (gallons == null || gallons <= 0)) return null;
  return { sales, gallons, gp, reportDate };
}

export type FuelSalesRow = {
  id: string;
  date: Date;
  data: Record<string, unknown>;
  confidence: number;
};

export function flattenFuelSales(
  rows: Array<{
    actionId: string;
    type: string;
    createdAt: Date;
    payloadJson: unknown;
    confidence: number;
  }>
): FuelSalesRow[] {
  const out: FuelSalesRow[] = [];
  for (const row of rows) {
    const payload = row.payloadJson && typeof row.payloadJson === 'object' ? (row.payloadJson as Record<string, unknown>) : {};
    const figures = fuelFigures(row.payloadJson);
    if (row.type === 'STORE_SALES' && !figures) continue;
    const sales = figures?.sales ?? num(payload.fuel_sales) ?? 0;
    const gallons = figures?.gallons ?? num(payload.gallons);
    const gp = figures?.gp ?? num(payload.fuel_gp);
    const reportDate = figures?.reportDate ?? (typeof payload.report_date === 'string' ? payload.report_date : null);
    out.push({
      id: row.actionId,
      date: row.createdAt,
      data: {
        ...payload,
        fuel_sales: sales,
        gallons,
        fuel_gp: gp,
        report_date: reportDate,
      },
      confidence: row.confidence,
    });
  }
  return out;
}
