import type { PrismaClient } from '@prisma/client';
import { PendingStatus } from '@prisma/client';
import { formatMoney } from './checks';
import { invoiceFromPayload, remainingOf, stillDue, tillCashPayments } from './invoiceBalance';
import { readStoredSetup } from '../tasks/storeSetup';
import { addDaysLocal, localDateString, localToUtc } from '../tasks/time';

/**
 * A short wrap-up of what was confirmed today.
 *
 * Non-7-Eleven: when the close is saved, one note with sales, invoices, paid-outs, deposits, orders.
 * 7-Eleven: sales stay on their POS; we only total till paid-outs as they were written (never pay rates).
 */

export type DayActivityRow = { type: string; payload: Record<string, unknown> };

export interface DayActivity {
  storeName: string;
  day: string;
  kind: 'store_day' | 'paid_outs';
  rows: DayActivityRow[];
  inspection: { percent: number } | null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dayLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function payloadOf(row: DayActivityRow): Record<string, unknown> {
  return row.payload ?? {};
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function payloadDate(payload: Record<string, unknown>): string | null {
  const report = payload.report as { reportDate?: unknown } | undefined;
  const invoice = payload.invoice as { invoiceDate?: unknown } | undefined;
  for (const value of [payload.report_date, report?.reportDate, payload.invoice_date, invoice?.invoiceDate]) {
    if (typeof value === 'string' && ISO_DAY.test(value)) return value;
  }
  return null;
}

/** The business day of a close (or invoice), else the store's calendar today. */
export function businessDayOf(rows: DayActivityRow[], now: Date, timeZone: string): string {
  for (const row of rows) {
    const day = payloadDate(payloadOf(row));
    if (day) return day;
  }
  return localDateString(now, timeZone);
}

function belongsToDay(
  row: DayActivityRow & { createdAt?: Date },
  day: string,
  start: Date,
  endOfDay: Date
): boolean {
  const dated = payloadDate(payloadOf(row));
  if (dated) return dated === day;
  const created = row.createdAt instanceof Date ? row.createdAt.getTime() : null;
  if (created == null) return true;
  return created >= start.getTime() && created < endOfDay.getTime();
}

/** Till money paid out, using the label the sender wrote. Never derived from hours or a wage. */
export function collectPaidOuts(rows: DayActivityRow[]): Array<{ label: string; amount: number }> {
  const out: Array<{ label: string; amount: number }> = [];
  for (const row of rows) {
    const p = payloadOf(row);
    const report = p.report as { payouts?: Array<{ label?: string; amount?: number }> } | undefined;
    if (p._kind === 'daily_close' && Array.isArray(report?.payouts)) {
      for (const pay of report.payouts) {
        if (typeof pay.amount === 'number' && Number.isFinite(pay.amount)) {
          out.push({ label: (pay.label || 'paid out').trim() || 'paid out', amount: pay.amount });
        }
      }
    }
    if (row.type === 'PAID_OUT') {
      const amount = num(p.amount) ?? 0;
      const label = String(p.reason ?? p.label ?? 'paid out').trim().slice(0, 40) || 'paid out';
      out.push({ label, amount });
    }
    if (row.type === 'INVOICE_EXPENSE' || p._kind === 'invoice') {
      const invoice = invoiceFromPayload(p);
      if (invoice) {
        const vendor = (invoice.vendorName ?? String(p.vendor ?? 'vendor')).trim() || 'vendor';
        for (const payment of tillCashPayments(invoice)) {
          out.push({ label: `${vendor} cash`, amount: payment.amount });
        }
      }
    }
  }
  return out;
}

export function formatDaySummary(activity: DayActivity): string | null {
  return activity.kind === 'paid_outs' ? formatPaidOutSummary(activity) : formatStoreDaySummary(activity);
}

function formatPaidOutSummary(activity: DayActivity): string | null {
  const paid = collectPaidOuts(activity.rows);
  if (paid.length === 0) return null;
  const total = round2(paid.reduce((sum, p) => sum + p.amount, 0));
  return [
    `💸 ${activity.storeName} · paid outs ${dayLabel(activity.day)}`,
    ...paid.map((p) => `• ${p.label} ${formatMoney(p.amount)}`),
    `Total ${formatMoney(total)}`,
  ].join('\n');
}

function formatStoreDaySummary(activity: DayActivity): string | null {
  const lines = [`📋 ${activity.storeName} · ${dayLabel(activity.day)}`];
  let cash = 0;
  let card = 0;
  let fuel = 0;
  let deposit = 0;
  let hasSales = false;
  const invoices: string[] = [];
  let invoiceTotal = 0;
  const deposits: number[] = [];
  let orders = 0;

  for (const row of activity.rows) {
    const p = payloadOf(row);
    if (row.type === 'STORE_SALES' || p._kind === 'daily_close') {
      hasSales = true;
      cash += num(p.cash) ?? 0;
      card += num(p.card) ?? 0;
      fuel += num(p.fuel_sales) ?? 0;
      if (num(p.deposit) != null) deposit += num(p.deposit) as number;
    }
    if ((row.type === 'INVOICE_EXPENSE' || p._kind === 'invoice') && p._kind !== 'invoice_payment') {
      const amount = num(p.amount) ?? num(p.total) ?? 0;
      invoiceTotal += amount;
      const vendor = String(p.vendor ?? 'Invoice').trim() || 'Invoice';
      const parsed = invoiceFromPayload(p);
      const left = parsed && stillDue(parsed) ? ` · ${formatMoney(remainingOf(parsed))} still due` : '';
      const invoice = p.invoice as { paymentStatus?: string } | undefined;
      const paid =
        left
          ? ''
          : invoice?.paymentStatus === 'paid_cash'
            ? ' paid cash'
            : invoice?.paymentStatus === 'paid_other'
              ? ' paid'
              : '';
      invoices.push(`${vendor} ${formatMoney(amount)}${paid}${left}`);
    }
    if (p._kind === 'deposit_receipt') {
      const amount = num(p.amount);
      if (amount != null) deposits.push(amount);
    }
    if (row.type === 'ORDER_REQUEST' || p._kind === 'order') orders += 1;
  }

  const paid = collectPaidOuts(activity.rows);

  if (hasSales) {
    const bits = [];
    if (cash) bits.push(`cash ${formatMoney(round2(cash))}`);
    if (card) bits.push(`card ${formatMoney(round2(card))}`);
    if (fuel) bits.push(`gas ${formatMoney(round2(fuel))}`);
    lines.push(bits.length > 0 ? `Sales: ${bits.join(' · ')}` : 'Sales posted');
  }
  if (paid.length > 0) {
    lines.push(`Paid out: ${paid.map((p) => `${p.label} ${formatMoney(p.amount)}`).join(', ')}`);
  }
  if (invoices.length > 0) {
    lines.push(`Invoices: ${invoices.join(', ')}${invoices.length > 1 ? ` · total ${formatMoney(round2(invoiceTotal))}` : ''}`);
  }
  if (deposits.length > 0) {
    lines.push(`Bank deposit ${formatMoney(round2(deposits.reduce((s, n) => s + n, 0)))}`);
  } else if (hasSales && deposit) {
    lines.push(`Deposit ${formatMoney(round2(deposit))}`);
  }
  if (orders > 0) lines.push(`Orders: ${orders}`);
  if (activity.inspection) lines.push(`Inspection ${activity.inspection.percent}%`);

  return lines.length > 1 ? lines.join('\n') : null;
}

export function summaryKindForStore(
  storeType: string | null | undefined,
  batch: Array<{ type: string; payload: Record<string, unknown> }>
): DayActivity['kind'] | null {
  const hasClose = batch.some((r) => r.type === 'STORE_SALES' || r.payload._kind === 'daily_close');
  const hasPaidOut = batch.some(
    (r) =>
      r.type === 'PAID_OUT' ||
      (Array.isArray((r.payload.report as { payouts?: unknown[] } | undefined)?.payouts) &&
        ((r.payload.report as { payouts: unknown[] }).payouts.length > 0))
  );
  if (storeType === 'convenience' || storeType === 'gas_station' || storeType === 'other') {
    return hasClose ? 'store_day' : null;
  }
  if (storeType === 'seven_eleven' && (hasPaidOut || hasClose)) return 'paid_outs';
  return null;
}

export async function loadDayActivity(
  prisma: PrismaClient,
  storeId: string,
  day: string,
  kind: DayActivity['kind'],
  now: Date = new Date()
): Promise<DayActivity | null> {
  const store = await prisma.storeConfig.findUnique({
    where: { storeId },
    select: { storeName: true, timezone: true, setupJson: true },
  });
  if (!store) return null;
  const timeZone = store.timezone?.trim() || 'America/New_York';
  const start = localToUtc(day, 0, timeZone);
  const endOfDay = localToUtc(addDaysLocal(day, 1), 0, timeZone);
  // A close sent the next morning still belongs to yesterday's business day.
  const queryEnd = new Date(Math.max(endOfDay.getTime() + 24 * 60 * 60 * 1000, now.getTime() + 60_000));

  const found = await prisma.pendingActions.findMany({
    where: { storeId, status: PendingStatus.CONFIRMED, createdAt: { gte: start, lt: queryEnd } },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });

  const rows = found
    .map((r) => ({
      type: r.type,
      payload: (r.payloadJson ?? {}) as Record<string, unknown>,
      createdAt: r.createdAt,
    }))
    .filter((r) => belongsToDay(r, day, start, endOfDay));

  let inspection: { percent: number } | null = null;
  try {
    const report = await prisma.inspectionReport.findFirst({
      where: { storeId, inspectedOn: { gte: start, lt: endOfDay } },
      orderBy: { inspectedOn: 'desc' },
      select: { percent: true },
    });
    if (report && Number.isFinite(report.percent)) inspection = { percent: report.percent };
  } catch {
    // Column or table may not exist yet; the wrap-up still works without it.
  }

  return {
    storeName: store.storeName,
    day,
    kind,
    rows: rows.map(({ type, payload }) => ({ type, payload })),
    inspection,
  };
}

export function storeTypeOf(setupJson: unknown): string | null {
  return readStoredSetup(setupJson)?.storeType ?? null;
}
