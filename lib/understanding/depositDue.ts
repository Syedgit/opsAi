import type { PrismaClient } from '@prisma/client';
import { PendingStatus } from '@prisma/client';
import { computeExpectedDeposit, formatMoney, inferDepositRules } from './checks';
import { parseStoredProfile } from './profileStore';
import { DailyCloseReportSchema, type DailyCloseReport } from './schema';
import type { DepositRule } from './profile';
import { storeTypeOf } from './daySummary';
import { readStoredSetup } from '../tasks/storeSetup';
import { addDaysLocal, localDateString, localMinutesOfDay, localToUtc, parseHHMM } from '../tasks/time';

/**
 * Non-7-Eleven: the cash that should go to the bank from confirmed daily closes, minus bank
 * slips seen in the chat. It keeps adding across days until a slip lands. 7-Eleven is skipped
 * (their sales stay on the POS). Never derived from hours or wages.
 */

const LOOKBACK_DAYS = 45;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Earliest local time we nudge, even if the store opened earlier. */
const NOT_BEFORE_MINUTES = 8 * 60;

/** Last resort when they wrote a deposit that does not add up (e.g. Denville 6611). */
const FROM_SALES: DepositRule = {
  includeCardSales: true,
  includeFuelSales: true,
  subtractPayouts: true,
  floatLeftInRegister: 0,
};

export type DepositEvent = { day: string; kind: 'close' | 'slip'; amount: number; seq: number };

export interface DepositDay {
  day: string;
  amount: number;
}

export interface DepositBag {
  remaining: number;
  days: DepositDay[];
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function payloadOf(row: { payload?: Record<string, unknown>; payloadJson?: unknown }): Record<string, unknown> {
  if (row.payload && typeof row.payload === 'object') return row.payload;
  const json = row.payloadJson;
  return json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
}

function dayLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function reportFromClosePayload(payload: Record<string, unknown>): DailyCloseReport | null {
  const parsed = DailyCloseReportSchema.safeParse(payload.report);
  if (parsed.success) return parsed.data;
  const payoutsRaw = (payload.report as { payouts?: unknown } | undefined)?.payouts;
  const payouts = Array.isArray(payoutsRaw)
    ? payoutsRaw.flatMap((p) => {
        if (!p || typeof p !== 'object') return [];
        const amount = num((p as { amount?: unknown }).amount);
        if (amount == null) return [];
        const label = String((p as { label?: unknown }).label ?? 'paid out').trim() || 'paid out';
        return [{ label, amount }];
      })
    : [];
  const built = DailyCloseReportSchema.safeParse({
    storeHint: null,
    reportDate: typeof payload.report_date === 'string' && ISO_DAY.test(payload.report_date) ? payload.report_date : null,
    cardSales: num(payload.card),
    cashSales: num(payload.cash),
    storeSalesTotal: num(payload.total_inside),
    fuelSales: num(payload.fuel_sales),
    payouts,
    reportedDeposit: num(payload.deposit),
  });
  return built.success ? built.data : null;
}

/** What should go to the bank: learned rule, else a written deposit that adds up, else card + cash + gas − payouts. */
export function expectedDepositAmount(report: DailyCloseReport, rule: DepositRule | null): number | null {
  if (rule) {
    const expected = computeExpectedDeposit(report, rule);
    if (expected != null) return expected;
  }
  if (report.reportedDeposit != null && inferDepositRules(report).length > 0) {
    return report.reportedDeposit;
  }
  return computeExpectedDeposit(report, FROM_SALES);
}

function eventDay(payload: Record<string, unknown>, createdAt: Date | undefined, timeZone: string): string {
  const report = payload.report as { reportDate?: unknown } | undefined;
  const receipt = payload.receipt as { depositDate?: unknown } | undefined;
  for (const value of [payload.report_date, report?.reportDate, payload.deposit_date, receipt?.depositDate]) {
    if (typeof value === 'string' && ISO_DAY.test(value)) return value;
  }
  return createdAt instanceof Date ? localDateString(createdAt, timeZone) : '1970-01-01';
}

export function eventsFromRows(
  rows: Array<{ type?: string; payload?: Record<string, unknown>; payloadJson?: unknown; createdAt?: Date }>,
  rule: DepositRule | null,
  timeZone: string
): DepositEvent[] {
  const out: DepositEvent[] = [];
  rows.forEach((row, seq) => {
    const payload = payloadOf(row);
    const day = eventDay(payload, row.createdAt, timeZone);
    if (payload._kind === 'daily_close' || row.type === 'STORE_SALES') {
      const report = reportFromClosePayload(payload);
      if (!report) return;
      const amount = expectedDepositAmount(report, rule);
      if (amount == null || amount <= 0) return;
      out.push({ day, kind: 'close', amount, seq });
      return;
    }
    if (payload._kind === 'deposit_receipt') {
      const amount = num(payload.amount) ?? num((payload.receipt as { totalDeposit?: unknown } | undefined)?.totalDeposit);
      if (amount == null || amount <= 0) return;
      out.push({ day, kind: 'slip', amount, seq });
    }
  });
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.kind.localeCompare(b.kind) || a.seq - b.seq);
}

/**
 * FIFO bag: each close adds, each bank slip pays off the oldest close first.
 * Morning uses closes before today; a same-day close is included when `includeTodayCloses` is set (after they post sales).
 */
export function foldDepositBag(
  events: DepositEvent[],
  today: string,
  options: { includeTodayCloses?: boolean } = {}
): DepositBag {
  const includeToday = options.includeTodayCloses === true;
  const open: DepositDay[] = [];
  for (const event of events) {
    if (event.kind === 'close') {
      if (event.day > today) continue;
      if (event.day === today && !includeToday) continue;
      open.push({ day: event.day, amount: event.amount });
      continue;
    }
    if (event.day > today) continue;
    let left = event.amount;
    while (left > 0.009 && open.length > 0) {
      const take = Math.min(open[0].amount, left);
      open[0] = { ...open[0], amount: round2(open[0].amount - take) };
      left = round2(left - take);
      if (open[0].amount <= 0.009) open.shift();
    }
  }
  const days = open.map((d) => ({ day: d.day, amount: round2(d.amount) }));
  const remaining = round2(days.reduce((sum, d) => sum + d.amount, 0));
  return { remaining, days };
}

export function coverLabel(days: DepositDay[]): string {
  if (days.length === 0) return '';
  const first = dayLabel(days[0].day);
  const last = dayLabel(days[days.length - 1].day);
  if (days.length === 1 || days[0].day === days[days.length - 1].day) return first;
  return `${first} – ${last}`;
}

export function formatDepositDue(storeName: string, bag: DepositBag): string | null {
  if (bag.remaining <= 0.009 || bag.days.length === 0) return null;
  const lines = [
    `🏦 ${storeName} · deposit due`,
    `${formatMoney(bag.remaining)} to take to the bank`,
    `Covering ${coverLabel(bag.days)}${bag.days.length > 1 ? ` (${bag.days.length} days)` : ''}`,
    'No bank slip in the chat yet — this will keep adding until you deposit.',
  ];
  if (bag.days.length > 1) {
    const shown = bag.days.slice(0, 5);
    for (const d of shown) lines.push(`• ${dayLabel(d.day)}  ${formatMoney(d.amount)}`);
    if (bag.days.length > shown.length) lines.push(`• and ${bag.days.length - shown.length} more`);
  }
  return lines.join('\n');
}

export function formatBagLine(bag: DepositBag): string | null {
  if (bag.remaining <= 0.009 || bag.days.length === 0) return null;
  return `To deposit: ${formatMoney(bag.remaining)} covering ${coverLabel(bag.days)} (no bank slip yet)`;
}

export function formatSlipResult(bag: DepositBag): string {
  if (bag.remaining <= 0.009) return '🏦 Bank slip saved. Deposit bag is clear.';
  return `🏦 Bank slip saved. Still ${formatMoney(bag.remaining)} to deposit covering ${coverLabel(bag.days)}.`;
}

export function isDepositStoreType(storeType: string | null | undefined): boolean {
  return storeType === 'convenience' || storeType === 'gas_station' || storeType === 'other';
}

/** Local minutes after midnight when the morning note may go out. */
export function depositNudgeMinutes(setupJson: unknown): number {
  const setup = readStoredSetup(setupJson);
  if (!setup || setup.open24h) return NOT_BEFORE_MINUTES;
  const open = setup.opensAt ? parseHHMM(setup.opensAt) : null;
  return Math.max(open ?? NOT_BEFORE_MINUTES, NOT_BEFORE_MINUTES);
}

export function depositDueMessageId(storeId: string, day: string): string {
  return `opsai-deposit-due:${storeId}:${day}`;
}

export async function loadDepositBag(
  prisma: PrismaClient,
  store: { storeId: string; timezone?: string | null; profileJson?: unknown },
  now: Date,
  options: { includeTodayCloses?: boolean } = {}
): Promise<DepositBag> {
  const timeZone = store.timezone?.trim() || 'America/New_York';
  const today = localDateString(now, timeZone);
  const start = localToUtc(addDaysLocal(today, -LOOKBACK_DAYS), 0, timeZone);
  const rows = await prisma.pendingActions.findMany({
    where: { storeId: store.storeId, status: PendingStatus.CONFIRMED, createdAt: { gte: start } },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });
  const rule = parseStoredProfile(store.profileJson).depositRule;
  const events = eventsFromRows(
    rows.map((r) => ({ type: r.type, payloadJson: r.payloadJson, createdAt: r.createdAt })),
    rule,
    timeZone
  );
  return foldDepositBag(events, today, options);
}

export async function maybeMorningDepositText(
  prisma: PrismaClient,
  store: { storeId: string; storeName: string; timezone?: string | null; setupJson?: unknown; profileJson?: unknown; active?: boolean },
  now: Date
): Promise<{ messageId: string; text: string } | null> {
  if (store.active === false) return null;
  if (!isDepositStoreType(storeTypeOf(store.setupJson))) return null;
  const timeZone = store.timezone?.trim() || 'America/New_York';
  if (localMinutesOfDay(now, timeZone) < depositNudgeMinutes(store.setupJson)) return null;
  const today = localDateString(now, timeZone);
  const messageId = depositDueMessageId(store.storeId, today);
  const already = await prisma.messageLog.findUnique({ where: { messageId }, select: { messageId: true } });
  if (already) return null;
  const bag = await loadDepositBag(prisma, store, now, { includeTodayCloses: false });
  const text = formatDepositDue(store.storeName, bag);
  if (!text) return null;
  return { messageId, text };
}
