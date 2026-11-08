import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { DepositRule, StoreProfile } from './profile';
import {
  MAX_PICTURE_TEMPLATES,
  PictureTemplateSchema,
  cleanPictureTemplate,
  type PictureTemplate,
} from './pictureTemplate';
import { StoreVendorsSchema, type StoreVendor } from './vendors';

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

const MessageSamplesSchema = z.object({
  dailyClose: z.string().trim().max(2000).optional(),
  invoice: z.string().trim().max(2000).optional(),
});

export const StoredProfileSchema = z.object({
  aliases: z.array(z.string()).default([]),
  depositRule: DepositRuleSchema.nullable().default(null),
  labelAliases: z.record(CanonicalLabelSchema).default({}),
  vendorAliases: z.record(z.string()).default({}),
  messageSamples: MessageSamplesSchema.default({}),
  pictureTemplates: z.array(PictureTemplateSchema).max(MAX_PICTURE_TEMPLATES).default([]),
  vendors: StoreVendorsSchema.default([]),
});
export type StoredProfile = z.infer<typeof StoredProfileSchema>;

const EMPTY: StoredProfile = {
  aliases: [],
  depositRule: null,
  labelAliases: {},
  vendorAliases: {},
  messageSamples: {},
  pictureTemplates: [],
  vendors: [],
};

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
    labelAliases: { ...base.labelAliases, ...stored.labelAliases },
    vendorAliases: { ...base.vendorAliases, ...stored.vendorAliases },
    messageSamples: stored.messageSamples,
    pictureTemplates: stored.pictureTemplates,
    vendors: stored.vendors,
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

export async function saveMessageSamples(
  prisma: PrismaClient,
  storeId: string,
  samples: { dailyClose?: string; invoice?: string },
): Promise<void> {
  const clean = MessageSamplesSchema.parse({
    dailyClose: samples.dailyClose?.trim() || undefined,
    invoice: samples.invoice?.trim() || undefined,
  });
  await updateStoredProfile(prisma, storeId, (current) => ({ ...current, messageSamples: clean }));
}

export async function saveVendors(prisma: PrismaClient, storeId: string, vendors: StoreVendor[]): Promise<void> {
  const clean = StoreVendorsSchema.parse(vendors);
  await updateStoredProfile(prisma, storeId, (current) => ({ ...current, vendors: clean }));
}

export async function savePictureTemplate(prisma: PrismaClient, storeId: string, input: Parameters<typeof cleanPictureTemplate>[0]): Promise<PictureTemplate> {
  const clean = cleanPictureTemplate(input);
  if (!clean) throw new Error('Mark at least one line to take or ignore.');
  await updateStoredProfile(prisma, storeId, (current) => {
    const rest = current.pictureTemplates.filter((t) => t.id !== clean.id);
    if (rest.length >= MAX_PICTURE_TEMPLATES && !current.pictureTemplates.some((t) => t.id === clean.id)) {
      throw new Error(`A store can have up to ${MAX_PICTURE_TEMPLATES} picture maps.`);
    }
    return { ...current, pictureTemplates: [...rest, clean] };
  });
  return clean;
}

export async function deletePictureTemplate(prisma: PrismaClient, storeId: string, id: string): Promise<void> {
  await updateStoredProfile(prisma, storeId, (current) => ({
    ...current,
    pictureTemplates: current.pictureTemplates.filter((t) => t.id !== id),
  }));
}
