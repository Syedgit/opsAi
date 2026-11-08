import { describeStore, lastWeekStarts, summarizeCeoBilling, tallyByWeek, weekStartUtc } from '../ceoUsage';

describe('ceoUsage weeks', () => {
  it('starts weeks on Monday UTC', () => {
    expect(weekStartUtc(new Date('2026-11-08T18:00:00Z'))).toBe('2026-11-02');
  });

  it('counts dates into the last eight weeks', () => {
    const weeks = lastWeekStarts(new Date('2026-11-08T12:00:00Z'), 4);
    expect(weeks[weeks.length - 1]).toBe('2026-11-02');
    const rows = tallyByWeek(
      [new Date('2026-11-08T01:00:00Z'), new Date('2026-11-03T01:00:00Z'), new Date('2026-10-01T01:00:00Z')],
      weeks,
    );
    expect(rows.find((row) => row.week === '2026-11-02')?.count).toBe(2);
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(2);
  });

  it('marks a store live when a group or a report exists', () => {
    const base = {
      storeId: 'S001',
      storeName: 'Rockaway',
      active: true,
      createdAt: new Date('2026-11-01T00:00:00Z'),
      users: [{ role: 'OWNER', user: { email: 'sam@store.com', name: 'Sam' } }],
      whatsappGroups: [] as { id: string }[],
    };
    expect(describeStore(base, undefined).live).toBe(false);
    expect(describeStore({ ...base, whatsappGroups: [{ id: 'g1' }] }, undefined).live).toBe(true);
    expect(describeStore(base, new Date('2026-11-08T00:00:00Z')).live).toBe(true);
  });
});

describe('ceoUsage billing', () => {
  const now = new Date('2026-11-08T18:00:00Z');

  function owner(partial: {
    email: string;
    stores: number;
    planStatus?: string;
    trialEndsAt?: Date;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
  }) {
    return {
      email: partial.email,
      name: null,
      createdAt: new Date('2026-10-01T00:00:00Z'),
      lastLoginAt: null,
      planStatus: partial.planStatus ?? 'trial',
      trialEndsAt: partial.trialEndsAt ?? new Date('2026-11-20T00:00:00Z'),
      isActive: true,
      stripeCustomerId: partial.stripeCustomerId ?? null,
      stripeSubscriptionId: partial.stripeSubscriptionId ?? null,
      _count: { stores: partial.stores },
    };
  }

  it('counts paying MRR at $25 per store and trial pipeline separately', () => {
    const money = summarizeCeoBilling(
      [
        owner({ email: 'paid@store.com', planStatus: 'active', stores: 6, stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' }),
        owner({ email: 'trial@store.com', planStatus: 'trial', stores: 2, trialEndsAt: new Date('2026-11-22T00:00:00Z') }),
        owner({ email: 'gone@store.com', planStatus: 'canceled', stores: 1 }),
        owner({
          email: 'late@store.com',
          planStatus: 'trial',
          stores: 3,
          trialEndsAt: new Date('2026-11-01T00:00:00Z'),
        }),
      ],
      now,
    );
    expect(money.mrrUsd).toBe(150);
    expect(money.arrUsd).toBe(1800);
    expect(money.trialPipelineUsd).toBe(50);
    expect(money.billedStores).toBe(6);
    expect(money.trialStores).toBe(2);
    expect(money.payingOwners).toBe(1);
    expect(money.trialOwners).toBe(1);
    expect(money.expiredOwners).toBe(1);
    expect(money.canceledOwners).toBe(1);
    expect(money.stripeSubscriptions).toBe(1);
    expect(money.owners.find((row) => row.email === 'late@store.com')?.planStatus).toBe('expired');
  });

  it('flags trials that end within three days', () => {
    const money = summarizeCeoBilling(
      [owner({ email: 'soon@store.com', planStatus: 'trial', stores: 4, trialEndsAt: new Date('2026-11-10T00:00:00Z') })],
      now,
    );
    expect(money.atRiskUsd).toBe(100);
  });
});
