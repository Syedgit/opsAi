/**
 * Conservative minutes a store skips vs typing the same close / invoice / sheet into a spreadsheet.
 * Labeled as an estimate on the billing page — not payroll, not a billed number.
 */
export const DESK_USD_PER_HOUR = 18;

export const MINUTES_PER = {
  closes: 12,
  invoices: 8,
  fuel: 6,
  payouts: 4,
  orders: 6,
  schedules: 15,
  prices: 5,
  deposits: 5,
  tasks: 3,
} as const;

export type SavingsKind = keyof typeof MINUTES_PER;

export type SavingsCounts = Record<SavingsKind, number>;

export const EMPTY_COUNTS: SavingsCounts = {
  closes: 0,
  invoices: 0,
  fuel: 0,
  payouts: 0,
  orders: 0,
  schedules: 0,
  prices: 0,
  deposits: 0,
  tasks: 0,
};

export function bucketSavedEntry(type: string, kind: string | null | undefined): SavingsKind | null {
  if (kind === 'invoice_payment') return null;
  if (kind === 'work_schedule') return 'schedules';
  if (kind === 'fuel_prices') return 'prices';
  if (kind === 'deposit_receipt') return 'deposits';
  if (type === 'STORE_SALES' || kind === 'daily_close') return 'closes';
  if (type === 'INVOICE_EXPENSE' || kind === 'invoice') return 'invoices';
  if (type === 'FUEL_SALES') return 'fuel';
  if (type === 'PAID_OUT') return 'payouts';
  if (type === 'ORDER_REQUEST' || kind === 'order') return 'orders';
  return null;
}

export function addCount(into: SavingsCounts, kind: SavingsKind, n = 1): void {
  into[kind] += n;
}

export function entriesSaved(counts: SavingsCounts): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

export function minutesSaved(counts: SavingsCounts): number {
  let minutes = 0;
  for (const kind of Object.keys(MINUTES_PER) as SavingsKind[]) {
    minutes += counts[kind] * MINUTES_PER[kind];
  }
  return minutes;
}

export function formatSavedTime(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 1) return '0 minutes';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const hours = Math.round((m / 60) * 10) / 10;
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

export function deskValueUsd(minutes: number, usdPerHour = DESK_USD_PER_HOUR): number {
  return Math.round((Math.max(0, minutes) / 60) * usdPerHour);
}

export function summarizeSavings(counts: SavingsCounts, monthlyFeeUsd = 0) {
  const minutes = minutesSaved(counts);
  const entries = entriesSaved(counts);
  const deskUsd = deskValueUsd(minutes);
  return {
    counts,
    entries,
    minutes,
    timeLabel: formatSavedTime(minutes),
    deskUsd,
    monthlyFeeUsd,
    worthMoreThanFee: monthlyFeeUsd > 0 && deskUsd >= monthlyFeeUsd,
  };
}

export function payloadKind(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const kind = (payload as { _kind?: unknown })._kind;
  return typeof kind === 'string' && kind ? kind : null;
}
