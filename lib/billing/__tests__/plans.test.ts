import {
  DEFAULT_PLAN_ID,
  PLAN_PRO,
  PLAN_STANDARD,
  TRIAL_DAYS,
  describeBilling,
  getPlan,
  monthlyFeeUsd,
  newAccountBilling,
  normalizePlanId,
  utcMonthRange,
} from '../plans';
import { BUSY_PHOTO, TYPICAL_PHOTO, launchUnitEconomics, monthlyAiCostUsd } from '../economics';

describe('tiered billing', () => {
  it('starts a 14-day Pro trial with no card', () => {
    const now = new Date('2026-11-08T18:00:00Z');
    const started = newAccountBilling(now);
    expect(started.plan).toBe(DEFAULT_PLAN_ID);
    expect(started.plan).toBe('pro');
    expect(started.planStatus).toBe('trial');
    expect(started.trialEndsAt.toISOString()).toBe('2026-11-22T18:00:00.000Z');
    expect(TRIAL_DAYS).toBe(14);
    expect(PLAN_PRO.monthlyUsdPerStore).toBe(45);
    expect(PLAN_STANDARD.monthlyUsdPerStore).toBe(25);
  });

  it('maps legacy store to pro and charges per plan', () => {
    expect(normalizePlanId('store')).toBe('pro');
    expect(normalizePlanId('pro')).toBe('pro');
    expect(monthlyFeeUsd(1, 'standard')).toBe(25);
    expect(monthlyFeeUsd(5, 'pro')).toBe(225);
    expect(monthlyFeeUsd(2, 'premium')).toBe(158);
    expect(describeBilling({ plan: 'store', planStatus: 'trial' }, 1).plan).toBe('pro');
    expect(describeBilling({ plan: 'pro', planStatus: 'trial' }, 5).monthlyUsd).toBe(225);
    expect(describeBilling({ plan: 'pro', planStatus: 'trial' }, 5).planName).toBe('Pro');
    expect(getPlan('premium').features.autoRemind).toBe(true);
    expect(getPlan('standard').features.chatAgent).toBe(true);
    expect(getPlan('standard').features.booksLookups).toBe(false);
    expect(getPlan('pro').features.booksLookups).toBe(true);
  });

  it('keeps access during the trial and closes it after', () => {
    const trialEndsAt = new Date('2026-11-22T18:00:00Z');
    const open = describeBilling({ plan: 'pro', planStatus: 'trial', trialEndsAt }, 1, new Date('2026-11-15T12:00:00Z'));
    expect(open.access).toBe(true);
    expect(open.status).toBe('trial');
    expect(open.daysLeft).toBe(8);
    const closed = describeBilling({ plan: 'pro', planStatus: 'trial', trialEndsAt }, 1, new Date('2026-11-23T00:00:00Z'));
    expect(closed.access).toBe(false);
    expect(closed.status).toBe('expired');
  });

  it('lets a paid plan through after the trial date', () => {
    const paid = describeBilling(
      { plan: 'pro', planStatus: 'active', trialEndsAt: new Date('2026-11-01T00:00:00Z') },
      1,
      new Date('2026-11-20T00:00:00Z')
    );
    expect(paid.access).toBe(true);
    expect(paid.status).toBe('active');
    expect(paid.features.booksLookups).toBe(true);
  });
});

describe('AI cost scales with stores, and is not a billed cap', () => {
  it('one busy-looking store at ~50 photos a day still fits under 25 USD on typical photos', () => {
    const one = launchUnitEconomics(1, 50, {} as NodeJS.ProcessEnv);
    expect(one.priceUsd).toBe(25);
    expect(one.typicalAiUsd).toBeCloseTo(8.25, 5);
    expect(one.busyAiUsd).toBeCloseTo(28.5, 5);
    expect(one.typicalMarginUsd).toBeGreaterThan(10);
  });

  it('five stores pay 125 and about 5x the AI', () => {
    const five = launchUnitEconomics(5, 50, {} as NodeJS.ProcessEnv);
    expect(five.priceUsd).toBe(125);
    expect(five.typicalAiUsd).toBeCloseTo(41.25, 4);
    expect(five.busyAiUsd).toBeCloseTo(142.5, 4);
    expect(monthlyAiCostUsd(50, TYPICAL_PHOTO, {} as NodeJS.ProcessEnv)).toBeCloseTo(0.275, 5);
    expect(monthlyAiCostUsd(50, BUSY_PHOTO, {} as NodeJS.ProcessEnv)).toBeCloseTo(0.95, 5);
  });
});

describe('utcMonthRange', () => {
  it('is the UTC calendar month', () => {
    expect(utcMonthRange(new Date('2026-11-08T18:00:00Z'))).toMatchObject({
      month: '2026-11',
      from: new Date('2026-11-01T00:00:00.000Z'),
      to: new Date('2026-12-01T00:00:00.000Z'),
    });
  });
});
