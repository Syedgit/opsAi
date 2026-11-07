import type { PrismaClient } from '@prisma/client';
import { estimateCostUsd, usageFromExtractedData } from './usage';

/**
 * A ceiling on AI readings per store per rolling 24 hours, so one stuck phone, a spam wave, or a
 * misbehaving integration cannot run up the bill. Normal use is far below it.
 *
 * Two kinds of cap, whichever hits first:
 *  count  MAX_AI_MESSAGES_PER_STORE_PER_DAY (default 20)
 *  dollars MAX_AI_USD_PER_STORE_PER_DAY (default $0.50) and MAX_AI_USD_PER_DAY across all stores (default $1)
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** When a call has no price (unknown model), count it as this so the dollar cap still bites. */
const UNPRICED_CALL_USD = 0.03;

/** Message-log classifications that mean the AI handled the message. */
export const AI_CLASSIFICATIONS = ['DAILY_CLOSE', 'INVOICE', 'DEPOSIT_RECEIPT', 'EQUIPMENT_ISSUE', 'UNKNOWN'];

export function maxAiMessagesPerStorePerDay(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env.MAX_AI_MESSAGES_PER_STORE_PER_DAY ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
}

export function maxAiUsdPerStorePerDay(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseFloat(env.MAX_AI_USD_PER_STORE_PER_DAY ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.5;
}

export function maxAiUsdPerDay(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseFloat(env.MAX_AI_USD_PER_DAY ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export interface AiBudget {
  allowed: boolean;
  /** True for the first message refused in the window, so the store is told once. */
  notify: boolean;
  used: number;
  limit: number;
  spentUsd: number;
  storeUsdLimit: number;
  totalSpentUsd: number;
  usdLimit: number;
}

function spendOf(extractedData: unknown, env: NodeJS.ProcessEnv): number {
  let sum = 0;
  for (const call of usageFromExtractedData(extractedData)) {
    if (call.kind !== 'extraction') continue;
    sum += estimateCostUsd(call, env) ?? UNPRICED_CALL_USD;
  }
  return sum;
}

export async function checkAiBudget(
  prisma: PrismaClient,
  storeId: string,
  now: Date = new Date(),
  limit: number = maxAiMessagesPerStorePerDay(),
  env: NodeJS.ProcessEnv = process.env
): Promise<AiBudget> {
  const since = new Date(now.getTime() - DAY_MS);
  const storeUsdLimit = maxAiUsdPerStorePerDay(env);
  const usdLimit = maxAiUsdPerDay(env);

  const used = await prisma.messageLog.count({
    where: { storeId, classification: { in: AI_CLASSIFICATIONS }, createdAt: { gte: since } },
  });

  const rows = await prisma.messageLog.findMany({
    where: { classification: { in: AI_CLASSIFICATIONS }, createdAt: { gte: since } },
    select: { storeId: true, extractedData: true },
  });

  let spentUsd = 0;
  let totalSpentUsd = 0;
  for (const row of rows) {
    const cost = spendOf(row.extractedData, env);
    totalSpentUsd += cost;
    if (row.storeId === storeId) spentUsd += cost;
  }

  const overCount = used >= limit;
  const overStoreUsd = spentUsd >= storeUsdLimit;
  const overTotalUsd = totalSpentUsd >= usdLimit;
  const allowed = !overCount && !overStoreUsd && !overTotalUsd;

  if (allowed) {
    return { allowed: true, notify: false, used, limit, spentUsd, storeUsdLimit, totalSpentUsd, usdLimit };
  }

  const alreadyTold = await prisma.messageLog.count({
    where: { storeId, classification: 'AI_LIMIT', createdAt: { gte: since } },
  });
  return {
    allowed: false,
    notify: alreadyTold === 0,
    used,
    limit,
    spentUsd,
    storeUsdLimit,
    totalSpentUsd,
    usdLimit,
  };
}
