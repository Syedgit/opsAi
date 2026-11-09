import type { PrismaClient } from '@prisma/client';
import type { DailyCloseReport } from './schema';
import { reportFromClosePayload } from './depositDue';
import { sameAmount, type Check } from './checks';
import { localDateString } from '../tasks/time';

export type OpenClose = {
  actionId: string;
  storeId: string;
  status: 'PENDING' | 'CONFIRMED';
  report: DailyCloseReport;
};

export type CloseMerge = {
  report: DailyCloseReport;
  mismatches: Check[];
};

function keep<T>(incoming: T | null | undefined, existing: T | null | undefined): T | null {
  return incoming != null ? incoming : existing ?? null;
}

function fixAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n);
}

/** POS Store Close / fuel page: gallons, discounts, or a printed day total. */
export function looksLikePosScreen(report: DailyCloseReport): boolean {
  return report.periodClosed != null || report.fuelGallons != null || report.fuelDiscounts != null || report.reportedDayTotal != null;
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

type ScreenField = {
  key: 'fuelSales' | 'reportedDeposit';
  id: string;
  label: string;
  fix: string;
};

const SCREEN_FIELDS: ScreenField[] = [
  { key: 'fuelSales', id: 'screenshot_gas', label: 'Gas', fix: 'gas' },
  { key: 'reportedDeposit', id: 'screenshot_deposit', label: 'Deposit', fix: 'deposit' },
];

function mergeScreenAmount(
  existing: number | null | undefined,
  incoming: number | null | undefined,
  keepIncoming: boolean,
  field: ScreenField,
  mismatches: Check[],
): number | null {
  if (incoming == null) return existing ?? null;
  if (existing == null) return incoming;
  if (sameAmount(existing, incoming, 1)) {
    mismatches.push({
      id: field.id,
      status: 'pass',
      message: `${field.label} matches the screenshot.`,
      expected: existing,
      actual: incoming,
      difference: 0,
    });
    return existing;
  }
  const screen = keepIncoming ? incoming : existing;
  const text = keepIncoming ? existing : incoming;
  mismatches.push({
    id: field.id,
    status: 'fail',
    message: `${field.label} on the screenshot does not match the end-of-day text. Reply FIX ${field.fix} ${fixAmount(screen)} to keep the screen, or FIX ${field.fix} ${fixAmount(text)} if the text is right.`,
    expected: screen,
    actual: text,
    difference: Math.round((text - screen) * 100) / 100,
  });
  return screen;
}

/**
 * Later pages fill empty fields. Gas and deposit from a POS screenshot are kept when the
 * typed close disagrees — the reply asks the sender to FIX.
 */
export function mergeCloseReports(existing: DailyCloseReport, incoming: DailyCloseReport): CloseMerge {
  const next = applyStoreCredit(incoming);
  const base = applyStoreCredit(existing);
  const keepIncomingScreen = looksLikePosScreen(next) && !looksLikePosScreen(base);
  const mismatches: Check[] = [];
  const report: DailyCloseReport = {
    storeHint: keep(next.storeHint, base.storeHint),
    reportDate: keep(next.reportDate, base.reportDate),
    cardSales: keep(next.cardSales, base.cardSales),
    cashSales: keep(next.cashSales, base.cashSales),
    storeSalesTotal: keep(next.storeSalesTotal, base.storeSalesTotal),
    fuelSales: mergeScreenAmount(base.fuelSales, next.fuelSales, keepIncomingScreen, SCREEN_FIELDS[0], mismatches),
    fuelGallons: keep(next.fuelGallons, base.fuelGallons),
    fuelDiscounts: keep(next.fuelDiscounts, base.fuelDiscounts),
    payouts: (next.payouts?.length ?? 0) > 0 ? next.payouts : base.payouts ?? [],
    reportedDeposit: mergeScreenAmount(
      base.reportedDeposit,
      next.reportedDeposit,
      keepIncomingScreen,
      SCREEN_FIELDS[1],
      mismatches,
    ),
    reportedDayTotal: keep(next.reportedDayTotal, base.reportedDayTotal),
    periodClosed: keep(next.periodClosed, base.periodClosed),
  };
  return { report, mismatches };
}

export function mergeDailyCloseReports(existing: DailyCloseReport, incoming: DailyCloseReport): DailyCloseReport {
  return mergeCloseReports(existing, incoming).report;
}

export function matchOpenClose(
  storeId: string,
  reportDate: string | null | undefined,
  openCloses: OpenClose[] | undefined,
  nearbyDays: string[] = [],
): OpenClose | null {
  if (!openCloses?.length) return null;
  if (reportDate) {
    return openCloses.find((row) => row.storeId === storeId && row.report.reportDate === reportDate) ?? null;
  }
  if (nearbyDays.length === 0) return null;
  return (
    openCloses.find(
      (row) => row.storeId === storeId && row.report.reportDate != null && nearbyDays.includes(row.report.reportDate),
    ) ?? null
  );
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
    if (!close) continue;
    const day = close.report.reportDate || localDateString(row.createdAt, 'America/New_York');
    if (!day) continue;
    const key = `${close.storeId}:${day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...close, report: { ...close.report, reportDate: close.report.reportDate || day } });
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
