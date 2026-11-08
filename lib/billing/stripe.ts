import type { PlanStatus } from './plans';

/** Stripe Checkout needs at least 48 hours of remaining trial to set trial_end. */
export const STRIPE_MIN_TRIAL_MS = 48 * 60 * 60 * 1000;

export type StripeConfig = {
  secretKey: string;
  webhookSecret: string;
  priceId: string;
  appUrl: string;
  ready: boolean;
  webhookReady: boolean;
};

export function stripeConfig(env: NodeJS.ProcessEnv = process.env): StripeConfig {
  const secretKey = env.STRIPE_SECRET_KEY?.trim() || '';
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() || '';
  const priceId = env.STRIPE_PRICE_ID?.trim() || '';
  const appUrl = (env.APP_URL?.trim() || 'http://localhost:3000').replace(/\/+$/, '');
  return {
    secretKey,
    webhookSecret,
    priceId,
    appUrl,
    ready: Boolean(secretKey && priceId),
    webhookReady: Boolean(secretKey && webhookSecret),
  };
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

export function patchFromStripeEvent(type: string, object: StripeObject): StripeBillingPatch | null {
  if (type === 'checkout.session.completed') {
    const stripeCustomerId = stripeId(object.customer);
    if (!stripeCustomerId) return null;
    return {
      stripeCustomerId,
      stripeSubscriptionId: stripeId(object.subscription) ?? undefined,
      planStatus: 'active',
    };
  }
  if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
    const status = typeof object.status === 'string' ? object.status : '';
    if (status === 'incomplete' || status === 'incomplete_expired') return null;
    return {
      stripeCustomerId: stripeId(object.customer),
      stripeSubscriptionId: typeof object.id === 'string' ? object.id : undefined,
      planStatus: planStatusFromStripeSubscription(status),
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
  return null;
}

export type CheckoutSessionParams = {
  customer: string;
  client_reference_id: string;
  mode: 'subscription';
  success_url: string;
  cancel_url: string;
  line_items: Array<{ price: string; quantity: number }>;
  subscription_data: { metadata: { userId: string }; trial_end?: number };
  metadata: { userId: string };
  allow_promotion_codes: true;
};

export function checkoutSessionParams(input: {
  customerId: string;
  userId: string;
  priceId: string;
  quantity: number;
  appUrl: string;
  trialEnd?: number;
}): CheckoutSessionParams {
  return {
    mode: 'subscription',
    customer: input.customerId,
    client_reference_id: input.userId,
    success_url: `${input.appUrl}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.appUrl}/billing?checkout=cancel`,
    line_items: [{ price: input.priceId, quantity: input.quantity }],
    subscription_data: {
      metadata: { userId: input.userId },
      ...(input.trialEnd ? { trial_end: input.trialEnd } : {}),
    },
    metadata: { userId: input.userId },
    allow_promotion_codes: true,
  };
}
