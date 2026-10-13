import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { DepositRule, StoreProfile } from './profile';

/**
 * What an owner has taught opsAi about one store. Stored as JSON on store_config.profile_json,
 * so new kinds of settings can be added without another migration.
 */

export const DepositRuleSchema = z.object({
  includeCardSales: z.boolean(),
  includeFuelSales: z.boolean(),
  subtractPayouts: z.boolean(),
  floatLeftInRegister: z.number().finite().nonnegative().default(0),
});

const CanonicalLabelSchema = z.enum(['card_sales', 'cash_sales', 'fuel_sales', 'payout', 'ignore']);

export const StoredProfileSchema = z.object({
  aliases: z.array(z.string()).default([]),
  depositRule: DepositRuleSchema.nullable().default(null),
  labelAliases: z.record(CanonicalLabelSchema).default({}),
  vendorAliases: z.record(z.string()).default({}),
});
export type StoredProfile = z.infer<typeof StoredProfileSchema>;

const EMPTY: StoredProfile = { aliases: [], depositRule: null, labelAliases: {}, vendorAliases: {} };

/** Anything unreadable is treated as "nothing taught yet" rather than breaking message handling. */
export function parseStoredProfile(json: unknown): StoredProfile {
  if (json == null) return { ...EMPTY };
  const parsed = StoredProfileSchema.safeParse(json);
  return parsed.success ? parsed.data : { ...EMPTY };
}

/** Defaults overlaid with what the owner taught. */
export function applyStoredProfile(base: StoreProfile, json: unknown): StoreProfile {
  const stored = parseStoredProfile(json);
  return {
    ...base,
    aliases: stored.aliases,
    depositRule: stored.depositRule,
    labelAliases: stored.labelAliases,
    vendorAliases: stored.vendorAliases,
  };
}

async function updateStoredProfile(
  prisma: PrismaClient,
  storeId: string,
  change: (current: StoredProfile) => StoredProfile
): Promise<void> {
  const row = await prisma.storeConfig.findUnique({ where: { storeId }, select: { profileJson: true } });
  if (!row) return;
  const next = change(parseStoredProfile(row.profileJson));
  await prisma.storeConfig.update({
    where: { storeId },
    data: { profileJson: next as unknown as Prisma.InputJsonValue },
  });
}

export async function saveDepositRule(prisma: PrismaClient, storeId: string, rule: DepositRule): Promise<void> {
  const clean = DepositRuleSchema.parse(rule);
  await updateStoredProfile(prisma, storeId, (current) => ({ ...current, depositRule: clean }));
}

export async function clearDepositRule(prisma: PrismaClient, storeId: string): Promise<void> {
  await updateStoredProfile(prisma, storeId, (current) => ({ ...current, depositRule: null }));
}
