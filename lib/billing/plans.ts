/**
 * Tiered pricing: Standard / Pro / Premium, billed per business per month.
 * Features (books look-ups, auto-remind) come with the plan — not a la carte add-ons.
 */

export const TRIAL_DAYS = 14;

export type PlanId = 'standard' | 'pro' | 'premium';
export type PlanStatus = 'trial' | 'active' | 'expired' | 'canceled';

export type PlanFeatures = {
  /** Owner/manager chat agent (ops help) — on every plan. */
  chatAgent: boolean;
  /** Grounded standing / invoices / DMR answers in chat (Pro+). */
  booksLookups: boolean;
  /** Shift task proof on WhatsApp. */
  staffShifts: boolean;
  /** Follow-up may auto-remind without a draft send. */
  autoRemind: boolean;
};

export type Plan = {
  id: PlanId;
  name: string;
  monthlyUsdPerStore: number;
  blurb: string;
  features: PlanFeatures;
  /** Highlight on the public pricing page. */
  popular?: boolean;
};

export const PLAN_STANDARD: Plan = {
  id: 'standard',
  name: 'Standard',
  monthlyUsdPerStore: 25,
  blurb: 'WhatsApp capture, dashboard, tasks, and one chat agent.',
  features: { chatAgent: true, booksLookups: false, staffShifts: true, autoRemind: false },
};

export const PLAN_PRO: Plan = {
  id: 'pro',
  name: 'Pro',
  monthlyUsdPerStore: 45,
  blurb: 'Everything in Standard plus books look-ups in chat.',
  features: { chatAgent: true, booksLookups: true, staffShifts: true, autoRemind: false },
  popular: true,
};

export const PLAN_PREMIUM: Plan = {
  id: 'premium',
  name: 'Premium',
  monthlyUsdPerStore: 79,
  blurb: 'Everything in Pro plus follow-up auto-remind.',
  features: { chatAgent: true, booksLookups: true, staffShifts: true, autoRemind: true },
};

export const PLANS: Plan[] = [PLAN_STANDARD, PLAN_PRO, PLAN_PREMIUM];

/** Recommended / trial default. */
export const DEFAULT_PLAN_ID: PlanId = 'pro';

/** @deprecated Prefer PLAN_PRO.monthlyUsdPerStore — kept for older call sites. */
export const USD_PER_STORE_PER_MONTH = PLAN_STANDARD.monthlyUsdPerStore;
/** @deprecated Books is a Pro+ feature, not a $20 add-on. */
export const ASK_DATA_USD_PER_STORE_PER_MONTH = 0;

/** @deprecated Use PLAN_STANDARD / PLAN_PRO. */
export const STORE_PLAN = PLAN_STANDARD;

export function isPlanId(value: unknown): value is PlanId {
  return value === 'standard' || value === 'pro' || value === 'premium';
}

/**
 * Map DB / legacy values onto a live tier.
 * Legacy `store` ($25 + optional books) → Pro so books look-ups stay available without an add-on SKU.
 */
export function normalizePlanId(raw?: string | null): PlanId {
  if (isPlanId(raw)) return raw;
  if (raw === 'store') return 'pro';
  return DEFAULT_PLAN_ID;
}

export function getPlan(raw?: string | null): Plan {
  const id = normalizePlanId(raw);
  return PLANS.find((p) => p.id === id) || PLAN_PRO;
}

/** Omit planId for Standard unit-economics math; pass the account plan for real billing. */
export function monthlyFeeUsd(storeCount: number, planId?: string | null): number {
  const n = Number.isFinite(storeCount) ? Math.max(0, Math.floor(storeCount)) : 0;
  const plan = planId === undefined ? PLAN_STANDARD : getPlan(planId);
  return n * plan.monthlyUsdPerStore;
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
    plan: DEFAULT_PLAN_ID,
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
  features: PlanFeatures;
  plans: Array<{
    id: PlanId;
    name: string;
    monthlyUsdPerStore: number;
    blurb: string;
    features: PlanFeatures;
    popular?: boolean;
  }>;
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
  const ends =
    asDate(user.trialEndsAt) ??
    (asDate(user.createdAt) ? addUtcDays(asDate(user.createdAt) as Date, TRIAL_DAYS) : null);
  const rawStatus =
    user.planStatus === 'active' ||
    user.planStatus === 'canceled' ||
    user.planStatus === 'expired' ||
    user.planStatus === 'trial'
      ? user.planStatus
      : 'trial';
  let status: PlanStatus = rawStatus;
  if (status === 'trial' && ends && now.getTime() >= ends.getTime()) status = 'expired';
  const access =
    status === 'active' || (status === 'trial' && (!ends || now.getTime() < ends.getTime()));
  const daysLeft =
    status === 'trial' && ends
      ? Math.max(0, Math.ceil((ends.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
      : null;
  const count = Number.isFinite(storeCount) ? Math.max(0, Math.floor(storeCount)) : 0;
  const plan = getPlan(user.plan);
  return {
    plan: plan.id,
    planName: plan.name,
    status,
    trialEndsAt: ends ? ends.toISOString() : null,
    daysLeft,
    access,
    monthlyUsdPerStore: plan.monthlyUsdPerStore,
    storeCount: count,
    monthlyUsd: monthlyFeeUsd(count, plan.id),
    features: plan.features,
    plans: PLANS.map((p) => ({
      id: p.id,
      name: p.name,
      monthlyUsdPerStore: p.monthlyUsdPerStore,
      blurb: p.blurb,
      features: p.features,
      popular: p.popular,
    })),
  };
}

/** Compact plan + features for store admin / agents UI. */
export function planBoardPayload(planRaw?: string | null): {
  id: PlanId;
  name: string;
  monthlyUsdPerStore: number;
  features: PlanFeatures;
} {
  const plan = getPlan(planRaw);
  return {
    id: plan.id,
    name: plan.name,
    monthlyUsdPerStore: plan.monthlyUsdPerStore,
    features: plan.features,
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
