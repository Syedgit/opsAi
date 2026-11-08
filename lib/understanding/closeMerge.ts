import type { PrismaClient } from '@prisma/client';
import type { DailyCloseReport } from './schema';
import { reportFromClosePayload } from './depositDue';

export type OpenClose = {
  actionId: string;
  storeId: string;
  status: 'PENDING' | 'CONFIRMED';
  report: DailyCloseReport;
};

function keep<T>(incoming: T | null | undefined, existing: T | null | undefined): T | null {
  return incoming != null ? incoming : existing ?? null;
}

/**
 * POS "Total Non Fuel Sales" is inside store credit (card). Copy it when card was not read
 * as its own line.
 */
export function applyStoreCredit(report: DailyCloseReport): DailyCloseReport {
  if (report.cardSales != null) return report;
  if (report.storeSalesTotal == null) return report;
  return { ...report, cardSales: report.storeSalesTotal };
}

/** Later close photos fill empty fields; a number on the new page replaces the old one. */
export function mergeDailyCloseReports(existing: DailyCloseReport, incoming: DailyCloseReport): DailyCloseReport {
  const next = applyStoreCredit(incoming);
  const base = applyStoreCredit(existing);
  return {
    storeHint: keep(next.storeHint, base.storeHint),
    reportDate: keep(next.reportDate, base.reportDate),
    cardSales: keep(next.cardSales, base.cardSales),
    cashSales: keep(next.cashSales, base.cashSales),
    storeSalesTotal: keep(next.storeSalesTotal, base.storeSalesTotal),
    fuelSales: keep(next.fuelSales, base.fuelSales),
    fuelGallons: keep(next.fuelGallons, base.fuelGallons),
    fuelDiscounts: keep(next.fuelDiscounts, base.fuelDiscounts),
    payouts: (next.payouts?.length ?? 0) > 0 ? next.payouts : base.payouts ?? [],
    reportedDeposit: keep(next.reportedDeposit, base.reportedDeposit),
    reportedDayTotal: keep(next.reportedDayTotal, base.reportedDayTotal),
    periodClosed: keep(next.periodClosed, base.periodClosed),
  };
}

export function matchOpenClose(
  storeId: string,
  reportDate: string | null | undefined,
  openCloses: OpenClose[] | undefined
): OpenClose | null {
  if (!reportDate || !openCloses?.length) return null;
  return openCloses.find((row) => row.storeId === storeId && row.report.reportDate === reportDate) ?? null;
}

export async function loadOpenCloses(prisma: PrismaClient, storeIds: string[]): Promise<OpenClose[]> {
  if (storeIds.length === 0) return [];
  const since = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
  const rows = await prisma.pendingActions.findMany({
    where: {
      storeId: { in: storeIds },
      type: 'STORE_SALES',
      status: { in: ['PENDING', 'CONFIRMED'] },
      createdAt: { gte: since },
    },
    select: { actionId: true, storeId: true, status: true, payloadJson: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const out: OpenClose[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const close = openCloseFromAction(row);
    if (!close?.report.reportDate) continue;
    const key = `${close.storeId}:${close.report.reportDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(close);
  }
  return out;
}

export function openCloseFromAction(row: {
  actionId: string;
  storeId: string;
  status: string;
  payloadJson: unknown;
}): OpenClose | null {
  if (row.status !== 'PENDING' && row.status !== 'CONFIRMED') return null;
  const payload = row.payloadJson && typeof row.payloadJson === 'object' ? (row.payloadJson as Record<string, unknown>) : {};
  if (payload._kind && payload._kind !== 'daily_close') return null;
  const report = reportFromClosePayload(payload);
  if (!report) return null;
  return { actionId: row.actionId, storeId: row.storeId, status: row.status, report };
}
