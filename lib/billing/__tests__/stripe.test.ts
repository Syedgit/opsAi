import {
  billedStoreQuantity,
  checkoutSessionParams,
  patchFromStripeEvent,
  planStatusFromStripeSubscription,
  stripeConfig,
  stripeTrialEndUnix,
  userIdFromStripeObject,
} from '../stripe';
import { applyStripeEvent } from '../stripeActions';

describe('stripeConfig', () => {
  it('is ready only with a secret key and a price id', () => {
    expect(stripeConfig({} as NodeJS.ProcessEnv).ready).toBe(false);
    expect(
      stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_ID: 'price_x' } as NodeJS.ProcessEnv).ready
    ).toBe(true);
    expect(
      stripeConfig({
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_WEBHOOK_SECRET: 'whsec_x',
        STRIPE_PRICE_ID: 'price_x',
      } as NodeJS.ProcessEnv).webhookReady
    ).toBe(true);
  });
});

describe('billedStoreQuantity', () => {
  it('is one store minimum, then one unit per location', () => {
    expect(billedStoreQuantity(0)).toBe(1);
    expect(billedStoreQuantity(1)).toBe(1);
    expect(billedStoreQuantity(5)).toBe(5);
  });
});

describe('stripeTrialEndUnix', () => {
  const now = new Date('2026-11-08T18:00:00Z');

  it('omits Stripe trial when fewer than 48 hours remain', () => {
    expect(stripeTrialEndUnix(new Date('2026-11-09T12:00:00Z'), now)).toBeUndefined();
  });

  it('keeps our remaining trial when Stripe will accept it', () => {
    expect(stripeTrialEndUnix(new Date('2026-11-22T18:00:00Z'), now)).toBe(
      Math.floor(new Date('2026-11-22T18:00:00Z').getTime() / 1000)
    );
  });
});

describe('planStatusFromStripeSubscription', () => {
  it('keeps access while Stripe is collecting or retrying', () => {
    expect(planStatusFromStripeSubscription('trialing')).toBe('active');
    expect(planStatusFromStripeSubscription('active')).toBe('active');
    expect(planStatusFromStripeSubscription('past_due')).toBe('active');
  });

  it('closes access when Stripe is done', () => {
    expect(planStatusFromStripeSubscription('canceled')).toBe('canceled');
    expect(planStatusFromStripeSubscription('unpaid')).toBe('canceled');
  });
});

describe('patchFromStripeEvent', () => {
  it('activates from Checkout', () => {
    expect(
      patchFromStripeEvent('checkout.session.completed', {
        customer: 'cus_1',
        subscription: 'sub_1',
        metadata: { userId: 'u1' },
      })
    ).toEqual({
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      planStatus: 'active',
    });
  });

  it('clears the subscription when it is deleted', () => {
    expect(patchFromStripeEvent('customer.subscription.deleted', { customer: 'cus_1', id: 'sub_1' })).toEqual({
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: null,
      planStatus: 'canceled',
    });
  });

  it('ignores a failed invoice so Stripe can retry', () => {
    expect(patchFromStripeEvent('invoice.payment_failed', { customer: 'cus_1' })).toBeNull();
  });

  it('reads userId from Checkout client_reference_id', () => {
    expect(userIdFromStripeObject({ client_reference_id: 'u9' })).toBe('u9');
    expect(userIdFromStripeObject({ metadata: { userId: 'u8' } })).toBe('u8');
  });
});

describe('checkoutSessionParams', () => {
  it('bills quantity per store and returns to /billing', () => {
    const params = checkoutSessionParams({
      customerId: 'cus_1',
      userId: 'u1',
      priceId: 'price_x',
      quantity: 5,
      appUrl: 'http://localhost:3000',
      trialEnd: 1700000000,
    });
    expect(params.line_items).toEqual([{ price: 'price_x', quantity: 5 }]);
    expect(params.success_url).toContain('/billing?checkout=success');
    expect(params.subscription_data.trial_end).toBe(1700000000);
    expect(params.metadata.userId).toBe('u1');
  });
});

describe('applyStripeEvent', () => {
  it('writes customer, subscription, and active status', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = {
      user: {
        findUnique: jest.fn(),
        update,
      },
    };
    const result = await applyStripeEvent(prisma as never, 'checkout.session.completed', {
      customer: 'cus_1',
      subscription: 'sub_1',
      metadata: { userId: 'u1' },
    });
    expect(result).toEqual({ applied: true, ignored: false });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        planStatus: 'active',
      },
    });
  });
});
