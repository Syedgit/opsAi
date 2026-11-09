import type { PrismaClient } from '@prisma/client';
import { storeTypeOf } from './understanding/daySummary';
import { reportFromClosePayload } from './understanding/depositDue';
import { invoiceFromPayload } from './understanding/invoiceBalance';
import { fuelFigures } from './understanding/fuelSalesRows';
import { pickDaySalesRows } from './understanding/salesPick';
import { addDaysLocal, daysBetween, localDateString, localToUtc, weekdayOf } from './tasks/time';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 92;
const LOOKBACK_DAYS = 14;

export type ReportPeriod = 'week' | 'month' | 'custom';

export type ReportDay = {
  day: string;
  sales: number;
  cash: number;
  card: number;
  fuel: number;
  gallons: number;
  buying: number;
  expenses: number;
  deposits: number;
  closes: number;
};

export type ReportVendor = { vendor: string; amount: number; count: number };

export type StoreReport = {
  storeId: string;
  storeName: string;
  from: string;
  to: string;
  label: string;
  period: ReportPeriod;
  totals: {
    sales: number;
    cash: number;
    card: number;
    fuel: number;
    gallons: number;
    buying: number;
    expenses: number;
    deposits: number;
    standing: number;
    closes: number;
    invoices: number;
    missingCloses: number;
  };
  days: ReportDay[];
  vendors: ReportVendor[];
  note: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function payloadOf(row: { payloadJson?: unknown }): Record<string, unknown> {
  const json = row.payloadJson;
  return json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
}

export function isIsoDay(value: string | null | undefined): value is string {
  return typeof value === 'string' && ISO_DAY.test(value);
}

/** Monday, or Friday for 7-Eleven (same week the schedule uses). */
export function reportWeekStart(today: string, storeType: string | null | undefined): string {
  const startsOn = storeType === 'seven_eleven' ? 5 : 1;
  const diff = (weekdayOf(today) - startsOn + 7) % 7;
  return addDaysLocal(today, -diff);
}

export function monthStart(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

function prettyDay(iso: string): string {
  return new Date(`${iso}T12:00:00.000Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function resolveReportRange(
  period: ReportPeriod,
  today: string,
  fromRaw?: string | null,
  toRaw?: string | null,
  storeType?: string | null,
): { from: string; to: string; label: string; period: ReportPeriod } {
  let from = isIsoDay(fromRaw) ? fromRaw : '';
  let to = isIsoDay(toRaw) ? toRaw : '';
  let used: ReportPeriod = period;

  if (period === 'custom' && from && to) {
    if (from > to) {
      const swap = from;
      from = to;
      to = swap;
    }
  } else if (period === 'month') {
    from = monthStart(today);
    to = today;
    used = 'month';
  } else {
    from = reportWeekStart(today, storeType);
    to = today;
    used = 'week';
  }

  if (daysBetween(from, to) > MAX_SPAN_DAYS) {
    from = addDaysLocal(to, -MAX_SPAN_DAYS);
  }

  const label =
    used === 'month'
      ? new Date(`${from}T12:00:00.000Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      : `${prettyDay(from)} – ${prettyDay(to)}`;
  return { from, to, label, period: used };
}

function emptyDay(day: string): ReportDay {
  return { day, sales: 0, cash: 0, card: 0, fuel: 0, gallons: 0, buying: 0, expenses: 0, deposits: 0, closes: 0 };
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    out.push(cursor);
    cursor = addDaysLocal(cursor, 1);
  }
  return out;
}

export function businessDayOfRow(
  row: { createdAt: Date; payloadJson?: unknown },
  timeZone: string,
): string {
  const p = payloadOf(row);
  const report = reportFromClosePayload(p);
  if (isIsoDay(report?.reportDate)) return report.reportDate;
  const invoice = invoiceFromPayload(p);
  if (isIsoDay(invoice?.invoiceDate)) return invoice.invoiceDate;
  const receipt = p.receipt && typeof p.receipt === 'object' ? (p.receipt as { depositDate?: unknown }) : null;
  for (const value of [p.report_date, p.invoice_date, p.deposit_date, receipt?.depositDate]) {
    if (isIsoDay(typeof value === 'string' ? value : null)) return value as string;
  }
  const fuel = fuelFigures(p);
  if (isIsoDay(fuel?.reportDate)) return fuel.reportDate;
  return localDateString(row.createdAt, timeZone);
}

function addClose(day: ReportDay, payload: Record<string, unknown>): void {
  const report = reportFromClosePayload(payload);
  const cash = report?.cashSales ?? num(payload.cash) ?? 0;
  const card = report?.cardSales ?? num(payload.card) ?? 0;
  const store = report?.storeSalesTotal ?? num(payload.total_inside) ?? round2(cash + card);
  const fuel = report?.fuelSales ?? num(payload.fuel_sales) ?? 0;
  const gallons = report?.fuelGallons ?? num(payload.gallons) ?? 0;
  const total = report?.reportedDayTotal ?? round2(store + fuel);
  day.cash = round2(day.cash + cash);
  day.card = round2(day.card + card);
  day.fuel = round2(day.fuel + fuel);
  day.gallons = round2(day.gallons + gallons);
  day.sales = round2(day.sales + total);
  day.closes += 1;
  const nested = payload.report && typeof payload.report === 'object' ? (payload.report as Record<string, unknown>) : null;
  const deposit = report?.reportedDeposit ?? num(payload.deposit) ?? num(nested?.reportedDeposit);
  if (deposit != null) day.deposits = round2(day.deposits + deposit);
  for (const payout of report?.payouts ?? []) {
    if (typeof payout.amount === 'number' && Number.isFinite(payout.amount)) {
      day.expenses = round2(day.expenses + payout.amount);
    }
  }
}

function addFuelOnly(day: ReportDay, payload: Record<string, unknown>): void {
  if (day.fuel > 0) return;
  const figures = fuelFigures(payload);
  if (!figures) return;
  day.fuel = round2(day.fuel + figures.sales);
  if (figures.gallons != null) day.gallons = round2(day.gallons + figures.gallons);
  if (day.sales <= 0 && figures.sales > 0) day.sales = round2(day.sales + figures.sales);
}

export function buildStoreReport(
  rows: Array<{ type: string; createdAt: Date; payloadJson?: unknown }>,
  range: { from: string; to: string; label: string; period: ReportPeriod },
  meta: { storeId: string; storeName: string; timeZone: string },
): StoreReport {
  const byDay = new Map(eachDay(range.from, range.to).map((day) => [day, emptyDay(day)]));
  const vendors = new Map<string, ReportVendor>();
  let invoiceCount = 0;

  const inRange = rows.filter((row) => {
    const day = businessDayOfRow(row, meta.timeZone);
    return day >= range.from && day <= range.to && byDay.has(day);
  });

  const salesByDay = new Map<string, typeof inRange>();
  for (const row of inRange) {
    const payload = payloadOf(row);
    if (row.type !== 'STORE_SALES' && payload._kind !== 'daily_close') continue;
    const key = businessDayOfRow(row, meta.timeZone);
    const list = salesByDay.get(key) ?? [];
    list.push(row);
    salesByDay.set(key, list);
  }
  for (const [key, list] of salesByDay) {
    const day = byDay.get(key);
    if (!day) continue;
    for (const row of pickDaySalesRows(list.map((item) => ({ ...item, payload: payloadOf(item) })))) {
      addClose(day, payloadOf(row));
    }
  }

  for (const row of inRange) {
    const day = byDay.get(businessDayOfRow(row, meta.timeZone));
    if (!day) continue;
    const payload = payloadOf(row);
    if (row.type === 'FUEL_SALES' && payload._kind !== 'daily_close') {
      addFuelOnly(day, payload);
      continue;
    }
    if (row.type === 'PAID_OUT') {
      day.expenses = round2(day.expenses + (num(payload.amount) ?? 0));
      continue;
    }
    if ((row.type === 'INVOICE_EXPENSE' || payload._kind === 'invoice') && payload._kind !== 'invoice_payment') {
      const invoice = invoiceFromPayload(payload);
      const amount = invoice?.total ?? num(payload.amount) ?? 0;
      if (amount <= 0) continue;
      day.buying = round2(day.buying + amount);
      invoiceCount += 1;
      const vendor = (invoice?.vendorName ?? String(payload.vendor ?? 'vendor')).trim() || 'vendor';
      const current = vendors.get(vendor) ?? { vendor, amount: 0, count: 0 };
      current.amount = round2(current.amount + amount);
      current.count += 1;
      vendors.set(vendor, current);
      continue;
    }
    if (payload._kind === 'deposit_receipt' && day.deposits === 0) {
      const amount = num(payload.amount);
      if (amount != null) day.deposits = round2(day.deposits + amount);
    }
  }

  const days = [...byDay.values()];
  const totals = days.reduce(
    (sum, day) => ({
      sales: round2(sum.sales + day.sales),
      cash: round2(sum.cash + day.cash),
      card: round2(sum.card + day.card),
      fuel: round2(sum.fuel + day.fuel),
      gallons: round2(sum.gallons + day.gallons),
      buying: round2(sum.buying + day.buying),
      expenses: round2(sum.expenses + day.expenses),
      deposits: round2(sum.deposits + day.deposits),
      standing: 0,
      closes: sum.closes + day.closes,
      invoices: invoiceCount,
      missingCloses: sum.missingCloses + (day.closes === 0 ? 1 : 0),
    }),
    {
      sales: 0,
      cash: 0,
      card: 0,
      fuel: 0,
      gallons: 0,
      buying: 0,
      expenses: 0,
      deposits: 0,
      standing: 0,
      closes: 0,
      invoices: 0,
      missingCloses: 0,
    },
  );
  totals.standing = round2(totals.sales - totals.buying - totals.expenses);
  totals.invoices = invoiceCount;

  return {
    storeId: meta.storeId,
    storeName: meta.storeName,
    from: range.from,
    to: range.to,
    label: range.label,
    period: range.period,
    totals,
    days,
    vendors: [...vendors.values()].sort((a, b) => b.amount - a.amount).slice(0, 8),
    note: 'Sales is the close total (inside plus gas when both are on the report). Deposit is the deposit figure written on the close. Buying is vendor invoices. Expenses are till paid-outs. This is not profit — rent, wages, and inventory counts are not included.',
  };
}

export async function loadStoreReport(
  prisma: PrismaClient,
  storeId: string,
  input: { period?: string; from?: string | null; to?: string | null; now?: Date },
): Promise<StoreReport | { error: string; status: number }> {
  const store = await prisma.storeConfig.findUnique({
    where: { storeId },
    select: { storeName: true, timezone: true, setupJson: true },
  });
  if (!store) return { error: 'Store not found', status: 404 };

  const timeZone = store.timezone || 'America/New_York';
  const now = input.now ?? new Date();
  const today = localDateString(now, timeZone);
  const period: ReportPeriod = input.period === 'month' || input.period === 'custom' ? input.period : 'week';
  const range = resolveReportRange(period, today, input.from, input.to, storeTypeOf(store.setupJson));
  const createdFrom = localToUtc(addDaysLocal(range.from, -LOOKBACK_DAYS), 0, timeZone);
  const createdTo = localToUtc(addDaysLocal(range.to, 2), 0, timeZone);

  const rows = await prisma.pendingActions.findMany({
    where: {
      storeId,
      status: 'CONFIRMED',
      createdAt: { gte: createdFrom, lt: createdTo },
    },
    select: { type: true, createdAt: true, payloadJson: true },
    orderBy: { createdAt: 'asc' },
    take: 8000,
  });

  return buildStoreReport(rows, range, { storeId, storeName: store.storeName, timeZone });
}

export function fallbackReportInsights(report: StoreReport): { insights: string[]; recommendations: string[] } {
  const t = report.totals;
  const insights: string[] = [];
  const recommendations: string[] = [];
  const money = (n: number) => `$${n.toFixed(2)}`;

  if (t.sales === 0 && t.buying === 0 && t.expenses === 0) {
    insights.push(`No confirmed closes, invoices, or paid-outs between ${report.from} and ${report.to}.`);
    recommendations.push('Ask the shift to send the daily close on WhatsApp so this report has numbers to stand on.');
    return { insights, recommendations };
  }

  insights.push(
    `Posted sales ${money(t.sales)} against buying ${money(t.buying)} and till expenses ${money(t.expenses)} (${t.standing >= 0 ? 'sales covered outflows' : 'outflows ran ahead of sales'}).`,
  );
  if (t.deposits > 0) insights.push(`Deposit on the close: ${money(t.deposits)}.`);
  if (t.fuel > 0) insights.push(`Fuel on the close: ${money(t.fuel)}${t.gallons ? ` · ${t.gallons.toFixed(0)} gallons` : ''}.`);
  if (report.vendors[0]) {
    insights.push(`Largest invoice vendor is ${report.vendors[0].vendor} at ${money(report.vendors[0].amount)}.`);
  }
  if (t.missingCloses > 0) {
    insights.push(`${t.missingCloses} day${t.missingCloses === 1 ? '' : 's'} in this window have no close.`);
    recommendations.push('Get the missing closes posted so the week is complete.');
  }
  if (t.buying > t.sales && t.sales > 0) {
    recommendations.push('Buying ran ahead of posted sales — check invoices against the close photos.');
  } else if (t.standing > 0) {
    recommendations.push('Keep sending the same close, invoices, and paid-outs; the graph follows those confirmed rows.');
  }
  if (recommendations.length === 0) {
    recommendations.push('This uses only numbers already saved from WhatsApp. It does not include rent or wages.');
  }
  return { insights, recommendations };
}

export async function aiReportInsights(
  report: StoreReport,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ insights: string[]; recommendations: string[] }> {
  const fallback = fallbackReportInsights(report);
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_MODEL?.trim() || env.OPENAI_TEXT_MODEL?.trim();
  if (!apiKey || !model) return fallback;

  try {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey });
    const t = report.totals;
    const response = await openai.chat.completions.create({
      model,
      temperature: 0.3,
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content:
            'You are looking at a convenience-store DMR. Use only the numbers given. Do not invent sales, invoices, or expenses. Never mention wages, payroll, hourly rates, or profit. Return JSON only: {"insights":[string],"recommendations":[string]} with 2-3 of each.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            store: report.storeName,
            period: report.label,
            from: report.from,
            to: report.to,
            totals: t,
            topVendors: report.vendors.slice(0, 5),
            busiestDays: [...report.days].sort((a, b) => b.sales - a.sales).slice(0, 3).map((d) => ({ day: d.day, sales: d.sales, buying: d.buying })),
            note: report.note,
          }),
        },
      ],
    });
    const text = response.choices[0]?.message?.content || '';
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : text) as { insights?: unknown; recommendations?: unknown };
    const insights = Array.isArray(parsed.insights) ? parsed.insights.filter((x) => typeof x === 'string') : [];
    const recommendations = Array.isArray(parsed.recommendations)
      ? parsed.recommendations.filter((x) => typeof x === 'string')
      : [];
    if (insights.length === 0) return fallback;
    return {
      insights: insights.slice(0, 4),
      recommendations: (recommendations.length ? recommendations : fallback.recommendations).slice(0, 4),
    };
  } catch {
    return fallback;
  }
}
