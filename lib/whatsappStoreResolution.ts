import type { PrismaClient } from '@prisma/client';

/**
 * SYNC: duplicate implementation lives in api/lib/whatsappStoreResolution.ts for Vercel.
 * How to resolve which store an incoming WhatsApp message belongs to.
 * Set WHATSAPP_STORE_ROUTING in .env at deploy / setup time.
 *
 * - phone_number: only StoreConfig.whatsappPhoneNumberId (per-number / shared WABA)
 * - group: only store_whatsapp_groups.whatsappGroupId (one number, many groups)
 * - both: try group_id first, then phone_number_id
 */
export type WhatsAppStoreRoutingMode = 'phone_number' | 'group' | 'both';

export function getWhatsAppStoreRoutingMode(): WhatsAppStoreRoutingMode {
  const v = (process.env.WHATSAPP_STORE_ROUTING || 'group').toLowerCase().trim();
  if (v === 'group' || v === 'both' || v === 'phone_number') {
    return v;
  }
  return 'phone_number';
}

export type ResolveStoreSource = 'group' | 'phone_number' | 'none';

export async function resolveStoreIdForIncomingMessage(
  prisma: PrismaClient,
  groupId: string | null | undefined,
  phoneNumberId: string | null | undefined
): Promise<{ storeId: string | null; source: ResolveStoreSource }> {
  const mode = getWhatsAppStoreRoutingMode();
  const gid = groupId?.trim() || null;
  const pid = phoneNumberId?.trim() || null;

  const tryGroup = mode === 'group' || mode === 'both';
  const tryPhone = mode === 'phone_number' || mode === 'both';

  if (tryGroup && gid) {
    const row = await prisma.storeWhatsAppGroup.findFirst({
      where: { whatsappGroupId: gid, active: true },
      select: { storeId: true },
    });
    if (row) {
      return { storeId: row.storeId, source: 'group' };
    }
    if (mode === 'group') {
      return { storeId: null, source: 'none' };
    }
  }

  if (tryPhone && pid) {
    const row = await prisma.storeConfig.findUnique({
      where: { whatsappPhoneNumberId: pid },
      select: { storeId: true, active: true },
    });
    if (row?.active) {
      return { storeId: row.storeId, source: 'phone_number' };
    }
  }

  return { storeId: null, source: 'none' };
}
