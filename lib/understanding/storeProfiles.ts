import type { PrismaClient } from '@prisma/client';
import { UserRole } from '@prisma/client';
import { buildDefaultProfile, type StoreProfile } from './profile';
import { applyStoredProfile } from './profileStore';

/**
 * Production `user_stores.role` is VARCHAR (scripts/create-initial-schema.sql).
 * Prisma's UserRole is a Postgres enum, so `WHERE role = OWNER` becomes
 * `varchar = "UserRole"` and Postgres raises 42883. Filter role in JS instead.
 */
function isOwnerRole(role: string): boolean {
  return role === UserRole.OWNER;
}

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
  const storeIds = new Set<string>([primaryStoreId]);
  if (includeOwnerSiblings) {
    try {
      const owners = (
        await prisma.userStore.findMany({
          where: { storeId: primaryStoreId },
          select: { userId: true, role: true },
        })
      ).filter((row) => isOwnerRole(row.role));
      if (owners.length > 0) {
        const siblings = await prisma.userStore.findMany({
          where: { userId: { in: owners.map((o) => o.userId) } },
          select: { storeId: true, role: true },
        });
        siblings.filter((s) => isOwnerRole(s.role)).forEach((s) => storeIds.add(s.storeId));
      }
    } catch (error) {
      // Keep this store's reports working even when user_stores.role cannot be queried.
      console.warn('Could not load owner sibling stores', error instanceof Error ? error.message : error);
    }
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
