import type { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { logApp, logAppError, serializeError } from '../requestLog';
import {
  billedStoreQuantity,
  checkoutSessionParams,
  patchFromStripeEvent,
  stripeConfig,
  stripeId,
  stripeTrialEndUnix,
  userIdFromStripeObject,
  type StripeBillingPatch,
  type StripeObject,
} from './stripe';

export function getStripe(env: NodeJS.ProcessEnv = process.env): Stripe | null {
  const key = stripeConfig(env).secretKey;
  if (!key) return null;
  return new Stripe(key);
}

type BillingUser = {
  id: string;
  email: string;
  name: string | null;
  planStatus: string | null;
  trialEndsAt: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stores: unknown[];
};

export async function loadBillingUser(prisma: PrismaClient, userId: string): Promise<BillingUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      isActive: true,
      planStatus: true,
      trialEndsAt: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      stores: { select: { storeId: true } },
    },
  });
  if (!user?.isActive) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    planStatus: user.planStatus,
    trialEndsAt: user.trialEndsAt,
    stripeCustomerId: user.stripeCustomerId,
    stripeSubscriptionId: user.stripeSubscriptionId,
    stores: user.stores,
  };
}

async function ensureCustomer(
  prisma: PrismaClient,
  stripe: Stripe,
  user: BillingUser
): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name || undefined,
    metadata: { userId: user.id },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

export async function createCheckoutUrl(
  prisma: PrismaClient,
  user: BillingUser,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true; url: string } | { ok: false; status: number; error: string }> {
  const cfg = stripeConfig(env);
  if (!cfg.ready) {
    return { ok: false, status: 503, error: 'Card checkout is not configured yet. Email support@opsai.us.' };
  }
  if (user.stores.length < 1) {
    return { ok: false, status: 400, error: 'Add a store before you subscribe.' };
  }
  const stripe = getStripe(env);
  if (!stripe) {
    return { ok: false, status: 503, error: 'Card checkout is not configured yet. Email support@opsai.us.' };
  }
  if (user.stripeSubscriptionId && user.planStatus === 'active') {
    return createPortalUrl(user, env);
  }

  try {
    const customerId = await ensureCustomer(prisma, stripe, user);
    const session = await stripe.checkout.sessions.create(
      checkoutSessionParams({
        customerId,
        userId: user.id,
        priceId: cfg.priceId,
        quantity: billedStoreQuantity(user.stores.length),
        appUrl: cfg.appUrl,
        trialEnd: stripeTrialEndUnix(user.trialEndsAt),
      }) as Stripe.Checkout.SessionCreateParams
    );
    if (!session.url) {
      return { ok: false, status: 500, error: 'Stripe did not return a checkout URL.' };
    }
    return { ok: true, url: session.url };
  } catch (error: unknown) {
    logAppError('billing.checkout', serializeError(error));
    return { ok: false, status: 502, error: 'Could not start checkout. Try again, or email support@opsai.us.' };
  }
}

export async function createPortalUrl(
  user: BillingUser,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true; url: string } | { ok: false; status: number; error: string }> {
  const cfg = stripeConfig(env);
  const stripe = getStripe(env);
  if (!cfg.ready || !stripe) {
    return { ok: false, status: 503, error: 'Card checkout is not configured yet. Email support@opsai.us.' };
  }
  if (!user.stripeCustomerId) {
    return { ok: false, status: 400, error: 'No card on file yet. Subscribe first.' };
  }
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${cfg.appUrl}/billing`,
    });
    return { ok: true, url: session.url };
  } catch (error: unknown) {
    logAppError('billing.portal', serializeError(error));
    return { ok: false, status: 502, error: 'Could not open the billing portal. Email support@opsai.us.' };
  }
}

export async function applyStripePatch(
  prisma: PrismaClient,
  lookup: { userId?: string | null; customerId?: string; subscriptionId?: string | null },
  patch: StripeBillingPatch
): Promise<boolean> {
  let userId = lookup.userId || null;
  if (!userId && lookup.customerId) {
    const byCustomer = await prisma.user.findUnique({
      where: { stripeCustomerId: lookup.customerId },
      select: { id: true },
    });
    userId = byCustomer?.id ?? null;
  }
  if (!userId && lookup.subscriptionId) {
    const bySub = await prisma.user.findUnique({
      where: { stripeSubscriptionId: lookup.subscriptionId },
      select: { id: true },
    });
    userId = bySub?.id ?? null;
  }
  if (!userId) return false;

  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(patch.stripeCustomerId ? { stripeCustomerId: patch.stripeCustomerId } : {}),
      ...(patch.stripeSubscriptionId !== undefined ? { stripeSubscriptionId: patch.stripeSubscriptionId } : {}),
      ...(patch.planStatus ? { planStatus: patch.planStatus } : {}),
    },
  });
  return true;
}

export async function applyStripeEvent(
  prisma: PrismaClient,
  type: string,
  object: StripeObject
): Promise<{ applied: boolean; ignored: boolean }> {
  const patch = patchFromStripeEvent(type, object);
  if (!patch) return { applied: false, ignored: true };
  const applied = await applyStripePatch(
    prisma,
    {
      userId: userIdFromStripeObject(object),
      customerId: patch.stripeCustomerId,
      subscriptionId: patch.stripeSubscriptionId ?? stripeId(object.id) ?? stripeId(object.subscription),
    },
    patch
  );
  return { applied, ignored: false };
}

export async function applyCheckoutSessionId(
  prisma: PrismaClient,
  userId: string,
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  if (!sessionId.startsWith('cs_')) return;
  const stripe = getStripe(env);
  if (!stripe) return;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const owner = userIdFromStripeObject(session as unknown as StripeObject);
    if (owner && owner !== userId) return;
    await applyStripeEvent(prisma, 'checkout.session.completed', {
      ...(session as unknown as StripeObject),
      client_reference_id: owner || userId,
      metadata: { userId },
    });
  } catch (error: unknown) {
    logAppError('billing.session', serializeError(error));
  }
}

export async function syncStripeSubscriptionQuantity(
  prisma: PrismaClient,
  userId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const cfg = stripeConfig(env);
  const stripe = getStripe(env);
  if (!cfg.ready || !stripe) return;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        stripeSubscriptionId: true,
        stores: { select: { storeId: true } },
      },
    });
    if (!user?.stripeSubscriptionId) return;
    const quantity = billedStoreQuantity(user.stores.length);
    const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
    const item = sub.items.data.find((row) => row.price.id === cfg.priceId) ?? sub.items.data[0];
    if (!item || item.quantity === quantity) return;
    await stripe.subscriptions.update(user.stripeSubscriptionId, {
      items: [{ id: item.id, quantity }],
      proration_behavior: 'create_prorations',
    });
    logApp('billing.quantity', { userId, quantity });
  } catch (error: unknown) {
    logAppError('billing.quantity', serializeError(error));
  }
}
