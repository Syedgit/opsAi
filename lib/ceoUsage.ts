import type { PrismaClient } from '@prisma/client';
import { describeBilling, USD_PER_STORE_PER_MONTH, type PlanStatus } from './billing/plans';
import { stripeConfig } from './billing/stripe';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKS = 8;
const TRIAL_AT_RISK_DAYS = 3;

export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function weekStartUtc(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const diff = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - diff);
  return utcDay(x);
}

export function lastWeekStarts(now: Date, weeks = WEEKS): string[] {
  const thisWeek = weekStartUtc(now);
  const start = new Date(`${thisWeek}T00:00:00.000Z`);
  const out: string[] = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    out.push(utcDay(new Date(start.getTime() - i * 7 * DAY_MS)));
  }
  return out;
}

export function tallyByWeek(dates: Date[], weeks: string[]): { week: string; count: number }[] {
  const counts = new Map(weeks.map((week) => [week, 0]));
  for (const date of dates) {
    const week = weekStartUtc(date);
    if (counts.has(week)) counts.set(week, (counts.get(week) || 0) + 1);
  }
  return weeks.map((week) => ({ week, count: counts.get(week) || 0 }));
}

type StoreRow = {
  storeId: string;
  storeName: string;
  active: boolean;
  createdAt: Date;
  users: { user: { email: string; name: string | null }; role: string }[];
  whatsappGroups: { id: string }[];
};

export function describeStore(
  store: StoreRow,
  lastReportAt: Date | undefined,
): {
  storeId: string;
  storeName: string;
  active: boolean;
  live: boolean;
  ownerEmail: string | null;
  createdAt: string;
  lastReportAt: string | null;
} {
  const owner = store.users.find((row) => row.role === 'OWNER') || store.users[0];
  const live = store.whatsappGroups.length > 0 || Boolean(lastReportAt);
  return {
    storeId: store.storeId,
    storeName: store.storeName,
    active: store.active,
    live,
    ownerEmail: owner?.user.email ?? null,
    createdAt: store.createdAt.toISOString(),
    lastReportAt: lastReportAt ? lastReportAt.toISOString() : null,
  };
}

type OwnerBillingRow = {
  email: string;
  name: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  planStatus: string | null;
  trialEndsAt: Date | null;
  isActive: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  _count: { stores: number };
};

const EMPTY_PLAN_COUNTS: Record<PlanStatus, number> = {
  trial: 0,
  active: 0,
  expired: 0,
  canceled: 0,
};

export function summarizeCeoBilling(users: OwnerBillingRow[], now = new Date()) {
  const byStatus = { ...EMPTY_PLAN_COUNTS };
  let mrrUsd = 0;
  let trialPipelineUsd = 0;
  let atRiskUsd = 0;
  let billedStores = 0;
  let trialStores = 0;
  let stripeCustomers = 0;
  let stripeSubscriptions = 0;

  const owners = users.map((user) => {
    const snapshot = describeBilling(user, user._count.stores, now);
    byStatus[snapshot.status] += 1;
    if (snapshot.status === 'active') {
      mrrUsd += snapshot.monthlyUsd;
      billedStores += snapshot.storeCount;
    }
    if (snapshot.status === 'trial') {
      trialPipelineUsd += snapshot.monthlyUsd;
      trialStores += snapshot.storeCount;
      if (snapshot.daysLeft != null && snapshot.daysLeft <= TRIAL_AT_RISK_DAYS) {
        atRiskUsd += snapshot.monthlyUsd;
      }
    }
    if (user.stripeCustomerId) stripeCustomers += 1;
    if (user.stripeSubscriptionId) stripeSubscriptions += 1;
    return {
      email: user.email,
      name: user.name,
      stores: snapshot.storeCount,
      planStatus: snapshot.status,
      monthlyUsd: snapshot.monthlyUsd,
      daysLeft: snapshot.daysLeft,
      trialEndsAt: snapshot.trialEndsAt,
      stripeCustomer: Boolean(user.stripeCustomerId),
      stripeSubscription: Boolean(user.stripeSubscriptionId),
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      isActive: user.isActive,
    };
  });

  return {
    priceUsdPerStore: USD_PER_STORE_PER_MONTH,
    mrrUsd,
    arrUsd: mrrUsd * 12,
    trialPipelineUsd,
    atRiskUsd,
    billedStores,
    trialStores,
    payingOwners: byStatus.active,
    trialOwners: byStatus.trial,
    expiredOwners: byStatus.expired,
    canceledOwners: byStatus.canceled,
    stripeCustomers,
    stripeSubscriptions,
    byStatus: (Object.keys(byStatus) as PlanStatus[]).map((status) => ({
      status,
      count: byStatus[status],
    })),
    owners,
  };
}

export async function loadCeoUsage(prisma: PrismaClient, now = new Date()) {
  const weeks = lastWeekStarts(now);
  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);

  const [userCount, users, stores, groups, reports, reports7, reports30] = await Promise.all([
    prisma.user.count(),
    prisma.user.findMany({
      select: {
        email: true,
        name: true,
        createdAt: true,
        lastLoginAt: true,
        planStatus: true,
        trialEndsAt: true,
        isActive: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        _count: { select: { stores: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.storeConfig.findMany({
      select: {
        storeId: true,
        storeName: true,
        active: true,
        createdAt: true,
        users: { select: { role: true, user: { select: { email: true, name: true } } } },
        whatsappGroups: { where: { active: true }, select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.storeWhatsAppGroup.count({ where: { active: true } }),
    prisma.pendingActions.findMany({
      select: { storeId: true, createdAt: true, status: true },
      orderBy: { createdAt: 'desc' },
      take: 4000,
    }),
    prisma.pendingActions.count({ where: { createdAt: { gte: since7 } } }),
    prisma.pendingActions.count({ where: { createdAt: { gte: since30 } } }),
  ]);

  const lastReport = new Map<string, Date>();
  const confirmedDates: Date[] = [];
  for (const row of reports) {
    if (!lastReport.has(row.storeId)) lastReport.set(row.storeId, row.createdAt);
    if (row.status === 'CONFIRMED') confirmedDates.push(row.createdAt);
  }

  const storeRows = stores.map((store) => describeStore(store, lastReport.get(store.storeId)));
  const liveStores = storeRows.filter((row) => row.live).length;
  const loggedIn7 = users.filter((user) => user.lastLoginAt && user.lastLoginAt.getTime() >= since7.getTime()).length;
  const { owners, ...money } = summarizeCeoBilling(users, now);

  return {
    generatedAt: now.toISOString(),
    totals: {
      users: userCount,
      loggedIn7,
      stores: stores.length,
      storesActive: stores.filter((row) => row.active).length,
      storesLive: liveStores,
      whatsappGroups: groups,
      reports7,
      reports30,
    },
    billing: {
      ...money,
      liveRunRateUsd: liveStores * USD_PER_STORE_PER_MONTH,
      stripeReady: stripeConfig().ready,
    },
    signupsByWeek: tallyByWeek(
      users.map((user) => user.createdAt),
      weeks,
    ),
    storesByWeek: tallyByWeek(
      stores.map((store) => store.createdAt),
      weeks,
    ),
    reportsByWeek: tallyByWeek(confirmedDates, weeks),
    stores: storeRows,
    owners,
  };
}

export async function noteOwnerLogin(
  prisma: { user: { update: (args: { where: { id: string }; data: { lastLoginAt: Date } }) => Promise<unknown> } },
  userId: string,
): Promise<void> {
  try {
    await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  } catch {
    // Column missing until add-last-login.sql runs; login must still succeed.
  }
}
