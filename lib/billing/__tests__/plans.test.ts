import { describeBilling, monthlyFeeUsd, newAccountBilling, STORE_PLAN, TRIAL_DAYS, utcMonthRange } from '../plans';
import { BUSY_PHOTO, TYPICAL_PHOTO, launchUnitEconomics, monthlyAiCostUsd } from '../economics';

describe('launch billing', () => {
  it('starts a 14-day Store trial with no card', () => {
    const now = new Date('2026-11-08T18:00:00Z');
    const started = newAccountBilling(now);
    expect(started.plan).toBe('store');
    expect(started.planStatus).toBe('trial');
    expect(started.trialEndsAt.toISOString()).toBe('2026-11-22T18:00:00.000Z');
    expect(TRIAL_DAYS).toBe(14);
    expect(STORE_PLAN.monthlyUsdPerStore).toBe(25);
  });

  it('charges 25 USD per store, so five locations are 125', () => {
    expect(monthlyFeeUsd(1)).toBe(25);
    expect(monthlyFeeUsd(5)).toBe(125);
    expect(monthlyFeeUsd(0)).toBe(0);
    expect(describeBilling({ planStatus: 'trial' }, 5).monthlyUsd).toBe(125);
    expect(describeBilling({ planStatus: 'trial' }, 5).storeCount).toBe(5);
  });

  it('keeps access during the trial and closes it after', () => {
    const trialEndsAt = new Date('2026-11-22T18:00:00Z');
    const open = describeBilling({ plan: 'store', planStatus: 'trial', trialEndsAt }, 1, new Date('2026-11-15T12:00:00Z'));
    expect(open.access).toBe(true);
    expect(open.status).toBe('trial');
    expect(open.daysLeft).toBe(8);
    const closed = describeBilling({ plan: 'store', planStatus: 'trial', trialEndsAt }, 1, new Date('2026-11-23T00:00:00Z'));
    expect(closed.access).toBe(false);
    expect(closed.status).toBe('expired');
  });

  it('lets a paid Store plan through after the trial date', () => {
    const paid = describeBilling(
      { plan: 'store', planStatus: 'active', trialEndsAt: new Date('2026-11-01T00:00:00Z') },
      1,
      new Date('2026-11-20T00:00:00Z')
    );
    expect(paid.access).toBe(true);
    expect(paid.status).toBe('active');
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
