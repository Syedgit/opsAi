import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { requireAuthUser } from '../../lib/apiAuth';
import { readJsonBody } from '../../lib/authCredentials';
import { PLANS, describeBilling, utcMonthRange } from '../../lib/billing/plans';
import {
  EMPTY_COUNTS,
  addCount,
  bucketSavedEntry,
  payloadKind,
  summarizeSavings,
  type SavingsCounts,
} from '../../lib/billing/savings';
import { stripeConfig } from '../../lib/billing/stripe';
import {
  applyCheckoutSessionId,
  createCheckoutUrl,
  createPortalUrl,
  loadBillingUser,
} from '../../lib/billing/stripeActions';
import { logAppError, loggedHandler, serializeError } from '../../lib/requestLog';

const prisma = new PrismaClient();

function queryString(req: VercelRequest, key: string): string | null {
  const value = req.query?.[key];
  if (typeof value === 'string' && value) return value;
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0]) return value[0];
  return null;
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const auth = requireAuthUser(req, res);
  if (!auth) return;

  if (req.method === 'POST') {
    const body = readJsonBody(req.body);
    const action = typeof body.action === 'string' ? body.action : '';
    const user = await loadBillingUser(prisma, auth.userId);
    if (!user) {
      res.status(401).json({ error: 'User not found or inactive' });
      return;
    }
    const result =
      action === 'portal'
        ? await createPortalUrl(user)
        : action === 'checkout'
          ? await createCheckoutUrl(prisma, user)
          : { ok: false as const, status: 400, error: 'Unknown billing action' };
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({ success: true, url: result.url });
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const sessionId = queryString(req, 'session_id');
    if (sessionId) {
      await applyCheckoutSessionId(prisma, auth.userId, sessionId);
    }

    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      include: { stores: { include: { store: { select: { storeId: true, storeName: true } } } } },
    });
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'User not found or inactive' });
      return;
    }

    const billing = describeBilling(user, user.stores.length);
    const { from, to, month } = utcMonthRange();
    const storeIds = user.stores.map((row) => row.store.storeId);
    const countsByStore = new Map<string, SavingsCounts>();
    for (const id of storeIds) countsByStore.set(id, { ...EMPTY_COUNTS });

    if (storeIds.length > 0) {
      const [actions, taskGroups] = await Promise.all([
        prisma.pendingActions.findMany({
          where: { storeId: { in: storeIds }, status: 'CONFIRMED', createdAt: { gte: from, lt: to } },
          select: { storeId: true, type: true, payloadJson: true },
          take: 20000,
        }),
        prisma.taskRun.groupBy({
          by: ['storeId'],
          where: { storeId: { in: storeIds }, status: 'DONE', completedAt: { gte: from, lt: to } },
          _count: { _all: true },
        }),
      ]);
      for (const row of actions) {
        const bucket = bucketSavedEntry(row.type, payloadKind(row.payloadJson));
        const counts = countsByStore.get(row.storeId);
        if (bucket && counts) addCount(counts, bucket);
      }
      for (const row of taskGroups) {
        const counts = countsByStore.get(row.storeId);
        if (counts) addCount(counts, 'tasks', row._count._all);
      }
    }

    const totalCounts = { ...EMPTY_COUNTS };
    for (const counts of countsByStore.values()) {
      for (const kind of Object.keys(totalCounts) as (keyof SavingsCounts)[]) {
        totalCounts[kind] += counts[kind];
      }
    }
    const savings = summarizeSavings(totalCounts, billing.monthlyUsd);
    const stores = user.stores.map((row) => {
      const counts = countsByStore.get(row.store.storeId) ?? { ...EMPTY_COUNTS };
      const storeSavings = summarizeSavings(counts);
      return {
        storeId: row.store.storeId,
        storeName: row.store.storeName,
        role: row.role,
        month,
        counts,
        entries: storeSavings.entries,
        minutes: storeSavings.minutes,
        timeLabel: storeSavings.timeLabel,
      };
    });
    const payments = stripeConfig();

    res.json({
      success: true,
      billing,
      plans: PLANS,
      trial: { days: 14, cardRequired: false },
      payments: {
        ready: payments.ready,
        hasCustomer: Boolean(user.stripeCustomerId),
        hasSubscription: Boolean(user.stripeSubscriptionId),
      },
      month,
      savings,
      stores,
    });
  } catch (error: unknown) {
    logAppError('billing', serializeError(error));
    res.status(500).json({ error: 'Could not load billing' });
  }
}

export default loggedHandler('billing', handler);
