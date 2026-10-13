import type { PrismaClient } from '@prisma/client';
import { UserRole } from '@prisma/client';
import { buildDefaultProfile, type StoreProfile } from './profile';
import { applyStoredProfile } from './profileStore';

/**
 * Stores a sender may report for: their own store, plus (for owners and managers) the other
 * stores owned by the same owner(s). One message can then cover several stores of one owner.
 * Plain staff only ever see their own store, and nobody can write to another owner's store.
 *
 * Each profile is the defaults overlaid with what the owner taught (store_config.profile_json).
 */
export async function loadStoreProfiles(
  prisma: PrismaClient,
  primaryStoreId: string,
  options: { includeOwnerSiblings?: boolean } = {}
): Promise<StoreProfile[]> {
  const includeOwnerSiblings = options.includeOwnerSiblings ?? true;
  const owners = includeOwnerSiblings
    ? await prisma.userStore.findMany({
        where: { storeId: primaryStoreId, role: UserRole.OWNER },
        select: { userId: true },
      })
    : [];

  const storeIds = new Set<string>([primaryStoreId]);
  if (owners.length > 0) {
    const siblings = await prisma.userStore.findMany({
      where: { userId: { in: owners.map((o) => o.userId) }, role: UserRole.OWNER },
      select: { storeId: true },
    });
    siblings.forEach((s) => storeIds.add(s.storeId));
  }

  const where = { storeId: { in: [...storeIds] }, active: true };
  let stores: Array<{ storeId: string; storeName: string; timezone: string; profileJson?: unknown }>;
  try {
    stores = await prisma.storeConfig.findMany({
      where,
      select: { storeId: true, storeName: true, timezone: true, profileJson: true },
    });
  } catch (error) {
    // The profile_json column has not been added to this database yet (scripts/add-store-profile.sql).
    // Keep working with default settings instead of failing every message.
    if ((error as { code?: string })?.code !== 'P2022') throw error;
    console.warn('store_config.profile_json is missing; run scripts/add-store-profile.sql');
    stores = await prisma.storeConfig.findMany({
      where,
      select: { storeId: true, storeName: true, timezone: true },
    });
  }

  const profiles = stores.map((s) =>
    applyStoredProfile(
      buildDefaultProfile({ storeId: s.storeId, storeName: s.storeName, timezone: s.timezone }),
      s.profileJson
    )
  );
  if (!profiles.some((p) => p.storeId === primaryStoreId)) {
    profiles.push(buildDefaultProfile({ storeId: primaryStoreId, storeName: primaryStoreId }));
  }

  // Sender's own store first.
  return profiles.sort((a, b) => Number(b.storeId === primaryStoreId) - Number(a.storeId === primaryStoreId));
}
