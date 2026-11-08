/**
 * Launch pricing: 14-day trial, then $25 per store per month.
 * AI cost follows the store (each location sends its own photos), so extra locations
 * are extra fee — not a cheap bundle. Readings are not capped on the plan; we watch
 * actual usage per store on the billing page.
 */

export const TRIAL_DAYS = 14;
export const USD_PER_STORE_PER_MONTH = 25;

export type PlanId = 'store';
export type PlanStatus = 'trial' | 'active' | 'expired' | 'canceled';

export type Plan = {
  id: PlanId;
  name: string;
  monthlyUsdPerStore: number;
  blurb: string;
};

export const STORE_PLAN: Plan = {
  id: 'store',
  name: 'Store',
  monthlyUsdPerStore: USD_PER_STORE_PER_MONTH,
  blurb: 'WhatsApp ops and dashboard. $25 per location per month after the trial.',
};

export const PLANS: Plan[] = [STORE_PLAN];

export function monthlyFeeUsd(storeCount: number): number {
  const n = Number.isFinite(storeCount) ? Math.max(0, Math.floor(storeCount)) : 0;
  return n * USD_PER_STORE_PER_MONTH;
}

export function addUtcDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

export function newAccountBilling(now: Date = new Date()): {
  plan: PlanId;
  planStatus: 'trial';
  trialEndsAt: Date;
} {
  return {
    plan: STORE_PLAN.id,
    planStatus: 'trial',
    trialEndsAt: addUtcDays(now, TRIAL_DAYS),
  };
}

export type BillingSnapshot = {
  plan: PlanId;
  planName: string;
  status: PlanStatus;
  trialEndsAt: string | null;
  daysLeft: number | null;
  access: boolean;
  monthlyUsdPerStore: number;
  storeCount: number;
  monthlyUsd: number;
};

export function describeBilling(
  user: {
    plan?: string | null;
    planStatus?: string | null;
    trialEndsAt?: Date | string | null;
    createdAt?: Date | string | null;
  },
  storeCount = 0,
  now: Date = new Date()
): BillingSnapshot {
  const ends = asDate(user.trialEndsAt) ?? (asDate(user.createdAt) ? addUtcDays(asDate(user.createdAt) as Date, TRIAL_DAYS) : null);
  const rawStatus = user.planStatus === 'active' || user.planStatus === 'canceled' || user.planStatus === 'expired' || user.planStatus === 'trial'
    ? user.planStatus
    : 'trial';
  let status: PlanStatus = rawStatus;
  if (status === 'trial' && ends && now.getTime() >= ends.getTime()) status = 'expired';
  const access = status === 'active' || (status === 'trial' && (!ends || now.getTime() < ends.getTime()));
  const daysLeft =
    status === 'trial' && ends ? Math.max(0, Math.ceil((ends.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))) : null;
  const count = Number.isFinite(storeCount) ? Math.max(0, Math.floor(storeCount)) : 0;
  return {
    plan: STORE_PLAN.id,
    planName: STORE_PLAN.name,
    status,
    trialEndsAt: ends ? ends.toISOString() : null,
    daysLeft,
    access,
    monthlyUsdPerStore: USD_PER_STORE_PER_MONTH,
    storeCount: count,
    monthlyUsd: monthlyFeeUsd(count),
  };
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function utcMonthRange(now: Date = new Date()): { from: Date; to: Date; month: string } {
  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth();
  const from = new Date(Date.UTC(year, monthIndex, 1));
  const to = new Date(Date.UTC(year, monthIndex + 1, 1));
  return { from, to, month: `${year}-${String(monthIndex + 1).padStart(2, '0')}` };
}
