import type { PrismaClient } from '@prisma/client';
import { isMissingTable } from './prismaMissing';

/**
 * Path A: when a registered store member messages from a group that is not yet mapped,
 * link group_id → their store (one active group per store).
 */
export async function tryAutoLinkGroupFromSender(
  prisma: PrismaClient,
  groupId: string,
  phoneE164: string
): Promise<{ storeId: string; linked: boolean } | null> {
  const gid = groupId.trim();
  if (!gid) return null;

  let existing: { storeId: string } | null = null;
  try {
    existing = await prisma.storeWhatsAppGroup.findFirst({
      where: { whatsappGroupId: gid, active: true },
      select: { storeId: true },
    });
  } catch (error) {
    if (!isMissingTable(error)) throw error;
    return null;
  }
  if (existing) {
    return { storeId: existing.storeId, linked: false };
  }

  const member = await prisma.userDirectory.findUnique({
    where: { phoneE164 },
    select: { storeId: true, isActive: true },
  });
  if (!member?.isActive || !member.storeId) {
    return null;
  }

  const storeActiveGroup = await prisma.storeWhatsAppGroup.findFirst({
    where: { storeId: member.storeId, active: true },
    select: { storeId: true, whatsappGroupId: true },
  });
  if (storeActiveGroup) {
    return { storeId: storeActiveGroup.storeId, linked: false };
  }

  await prisma.storeWhatsAppGroup.create({
    data: {
      whatsappGroupId: gid,
      storeId: member.storeId,
      active: true,
    },
  });

  return { storeId: member.storeId, linked: true };
}

/** Fallback when group routing misses: resolve store by sender phone in user_directory. */
export async function resolveStoreIdBySenderPhone(
  prisma: PrismaClient,
  phoneE164: string
): Promise<string | null> {
  const member = await prisma.userDirectory.findUnique({
    where: { phoneE164 },
    select: { storeId: true, isActive: true },
  });
  if (!member?.isActive || !member.storeId) return null;
  return member.storeId;
}
