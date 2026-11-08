import { estimateCostUsd } from '../understanding/usage';
import { monthlyFeeUsd } from './plans';

/**
 * What we assume a typical AI reading costs on the default photo model (Terra).
 * Close photos and invoices sit near TYPICAL; a busy receipt or a dense schedule sheet is BUSY.
 * These are planning numbers only — the plan does not cap readings.
 */
export const TYPICAL_PHOTO = { model: 'gpt-6.1-terra', inputTokens: 3000, outputTokens: 500 };
export const BUSY_PHOTO = { model: 'gpt-6.1-terra', inputTokens: 15000, outputTokens: 800 };

/** Busy-store planning figure (not a billed quota): ~50 AI photos a day. */
export const PLANNING_READINGS_PER_STORE_PER_DAY = 50;
const PLANNING_DAYS = 30;

export function monthlyAiCostUsd(
  readings: number,
  sample: { model: string; inputTokens: number; outputTokens: number } = TYPICAL_PHOTO,
  env: NodeJS.ProcessEnv = process.env
): number {
  const each = estimateCostUsd({ kind: 'extraction', ...sample }, env) ?? 0;
  return each * readings;
}

export function launchUnitEconomics(
  storeCount = 1,
  readingsPerStorePerDay = PLANNING_READINGS_PER_STORE_PER_DAY,
  env: NodeJS.ProcessEnv = process.env
) {
  const readingsPerStore = readingsPerStorePerDay * PLANNING_DAYS;
  const typicalEach = monthlyAiCostUsd(readingsPerStore, TYPICAL_PHOTO, env);
  const busyEach = monthlyAiCostUsd(readingsPerStore, BUSY_PHOTO, env);
  const fee = monthlyFeeUsd(storeCount);
  return {
    storeCount,
    readingsPerStorePerDay,
    readingsPerStorePerMonth: readingsPerStore,
    priceUsd: fee,
    typicalAiUsd: typicalEach * storeCount,
    busyAiUsd: busyEach * storeCount,
    typicalMarginUsd: fee - typicalEach * storeCount,
    busyMarginUsd: fee - busyEach * storeCount,
  };
}
