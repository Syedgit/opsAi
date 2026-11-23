import {
  getPlan,
  isPlanId,
  monthlyFeeUsd,
  type PlanId,
  type PlanStatus,
} from './plans';

/** Stripe Checkout needs at least 48 hours of remaining trial to set trial_end. */
export const STRIPE_MIN_TRIAL_MS = 48 * 60 * 60 * 1000;

export type StripeConfig = {
  secretKey: string;
  webhookSecret: string;
  priceId: string;
  /** Optional per-tier Price IDs; fall back to `priceId` when unset. */
  priceIds: Record<PlanId, string>;
  /** @deprecated Optional legacy Books add-on Price ID — tiers include features now. */
  booksPriceId: string;
  appUrl: string;
  ready: boolean;
  webhookReady: boolean;
  booksReady: boolean;
};

export function stripeConfig(env: NodeJS.ProcessEnv = process.env): StripeConfig {
  const secretKey = env.STRIPE_SECRET_KEY?.trim() || '';
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() || '';
  const priceId = env.STRIPE_PRICE_ID?.trim() || '';
  const booksPriceId = env.STRIPE_BOOKS_PRICE_ID?.trim() || '';
  const appUrl = (env.APP_URL?.trim() || 'http://localhost:3000').replace(/\/+$/, '');
  const priceIds: Record<PlanId, string> = {
    standard: env.STRIPE_PRICE_ID_STANDARD?.trim() || priceId,
    pro: env.STRIPE_PRICE_ID_PRO?.trim() || priceId,
    premium: env.STRIPE_PRICE_ID_PREMIUM?.trim() || priceId,
  };
  return {
    secretKey,
    webhookSecret,
    priceId,
    priceIds,
    booksPriceId,
    appUrl,
    ready: Boolean(secretKey && priceId),
    webhookReady: Boolean(secretKey && webhookSecret),
    booksReady: Boolean(secretKey && booksPriceId),
  };
}

/** Stripe Price ID for a plan tier (per-tier env, else default STRIPE_PRICE_ID). */
export function priceIdForPlan(planId: PlanId | string | null | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const cfg = stripeConfig(env);
  const id = isPlanId(planId) ? planId : 'pro';
  return cfg.priceIds[id] || cfg.priceId;
}

/** Stripe line quantity. Never 0 — Checkout and subscription items reject it. */
export function billedStoreQuantity(storeCount: number): number {
  const n = Number.isFinite(storeCount) ? Math.floor(storeCount) : 0;
  return Math.max(1, n);
}

export function stripeTrialEndUnix(trialEndsAt: Date | null | undefined, now: Date = new Date()): number | undefined {
  if (!trialEndsAt) return undefined;
  if (trialEndsAt.getTime() < now.getTime() + STRIPE_MIN_TRIAL_MS) return undefined;
  return Math.floor(trialEndsAt.getTime() / 1000);
}

export function planStatusFromStripeSubscription(status: string): PlanStatus {
  if (status === 'active' || status === 'trialing' || status === 'past_due') return 'active';
  if (status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired') return 'canceled';
  return 'expired';
}

export type StripeObject = Record<string, unknown>;

export type StripeBillingPatch = {
  stripeCustomerId?: string;
  stripeSubscriptionId?: string | null;
  planStatus?: PlanStatus;
  plan?: PlanId;
};

export function stripeId(value: unknown): string | undefined {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string' && id) return id;
  }
  return undefined;
}

export function userIdFromStripeObject(object: StripeObject): string | null {
  const meta = object.metadata;
  if (meta && typeof meta === 'object' && meta !== null) {
    const userId = (meta as { userId?: unknown }).userId;
    if (typeof userId === 'string' && userId) return userId;
  }
  if (typeof object.client_reference_id === 'string' && object.client_reference_id) {
    return object.client_reference_id;
  }
  return null;
}

export function planIdFromStripeObject(object: StripeObject): PlanId | null {
  const meta = object.metadata;
  if (meta && typeof meta === 'object' && meta !== null) {
    const plan = (meta as { plan?: unknown }).plan;
    if (isPlanId(plan)) return plan;
  }
  return null;
}

export function patchFromStripeEvent(type: string, object: StripeObject): StripeBillingPatch | null {
  const plan = planIdFromStripeObject(object) ?? undefined;
  if (type === 'checkout.session.completed') {
    const stripeCustomerId = stripeId(object.customer);
    if (!stripeCustomerId) return null;
    return {
      stripeCustomerId,
      stripeSubscriptionId: stripeId(object.subscription) ?? undefined,
      planStatus: 'active',
      ...(plan ? { plan } : {}),
    };
  }
  if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
    const status = typeof object.status === 'string' ? object.status : '';
    if (status === 'incomplete' || status === 'incomplete_expired') return null;
    return {
      stripeCustomerId: stripeId(object.customer),
      stripeSubscriptionId: typeof object.id === 'string' ? object.id : undefined,
      planStatus: planStatusFromStripeSubscription(status),
      ...(plan ? { plan } : {}),
    };
  }
  if (type === 'customer.subscription.deleted') {
    return {
      stripeCustomerId: stripeId(object.customer),
      stripeSubscriptionId: null,
      planStatus: 'canceled',
    };
  }
  if (type === 'invoice.paid') {
    return {
      stripeCustomerId: stripeId(object.customer),
      stripeSubscriptionId: stripeId(object.subscription),
      planStatus: 'active',
    };
  }
  // Keep access while Stripe retries, but mark past_due via subscription.updated normally.
  // Surface a soft warning: stay "active" so WhatsApp keeps working; billing UI reads pastDue from Stripe.
  if (type === 'invoice.payment_failed') {
    return {
      stripeCustomerId: stripeId(object.customer),
      stripeSubscriptionId: stripeId(object.subscription),
      planStatus: 'active',
    };
  }
  return null;
}

export type CheckoutSessionParams = {
  customer: string;
  client_reference_id: string;
  mode: 'subscription';
  success_url: string;
  cancel_url: string;
  line_items: Array<{ price: string; quantity: number }>;
  subscription_data: { metadata: { userId: string; plan?: string }; trial_end?: number };
  metadata: { userId: string; plan?: string; booksQuantity?: string };
  allow_promotion_codes: true;
};

export function checkoutSessionParams(input: {
  customerId: string;
  userId: string;
  priceId: string;
  quantity: number;
  appUrl: string;
  trialEnd?: number;
  planId?: PlanId;
  booksPriceId?: string;
  booksQuantity?: number;
}): CheckoutSessionParams {
  const line_items: Array<{ price: string; quantity: number }> = [
    { price: input.priceId, quantity: input.quantity },
  ];
  const booksQty = Math.max(0, Math.floor(input.booksQuantity || 0));
  if (input.booksPriceId && booksQty > 0) {
    line_items.push({ price: input.booksPriceId, quantity: booksQty });
  }
  const planMeta = input.planId ? { plan: input.planId } : {};
  return {
    mode: 'subscription',
    customer: input.customerId,
    client_reference_id: input.userId,
    success_url: `${input.appUrl}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.appUrl}/billing?checkout=cancel`,
    line_items,
    subscription_data: {
      metadata: { userId: input.userId, ...planMeta },
      ...(input.trialEnd ? { trial_end: input.trialEnd } : {}),
    },
    metadata: {
      userId: input.userId,
      ...planMeta,
      ...(booksQty > 0 ? { booksQuantity: String(booksQty) } : {}),
    },
    allow_promotion_codes: true,
  };
}

/**
 * Monthly estimate from the account plan × store count.
 * `booksStoreCount` is ignored (kept for call-site compat); books is a Pro+ feature, not an add-on.
 */
export function estimateMonthlyUsd(
  storeCount: number,
  _booksStoreCount: number = 0,
  env: NodeJS.ProcessEnv = process.env,
  planId?: string | null
): {
  baseUsd: number;
  booksUsd: number;
  totalUsd: number;
  booksPriceConfigured: boolean;
  monthlyUsdPerStore: number;
  planId: string;
  planName: string;
} {
  const plan = getPlan(planId);
  const totalUsd = monthlyFeeUsd(storeCount, plan.id);
  return {
    baseUsd: totalUsd,
    booksUsd: 0,
    totalUsd,
    booksPriceConfigured: Boolean(stripeConfig(env).booksPriceId),
    monthlyUsdPerStore: plan.monthlyUsdPerStore,
    planId: plan.id,
    planName: plan.name,
  };
}
