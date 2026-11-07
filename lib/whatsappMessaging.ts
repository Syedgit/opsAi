import type { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { getWhatsAppStoreRoutingMode } from './whatsappStoreResolution';

const WHATSAPP_API_URL = 'https://graph.facebook.com/v22.0';

async function resolvePhoneNumberId(prisma: PrismaClient, storeId?: string): Promise<string | null> {
  const envId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || null;
  // One shared Cloud API line for all stores: never let a leftover per-store test ID send.
  if (getWhatsAppStoreRoutingMode() === 'group' && envId) {
    return envId;
  }
  let phoneNumberId: string | null = null;
  if (storeId) {
    const store = await prisma.storeConfig.findUnique({
      where: { storeId },
      select: { whatsappPhoneNumberId: true },
    });
    phoneNumberId = store?.whatsappPhoneNumberId ?? null;
  }
  return phoneNumberId || envId;
}

async function postText(
  prisma: PrismaClient,
  target: { to: string; group: boolean },
  message: string,
  storeId?: string
): Promise<boolean> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('WHATSAPP_ACCESS_TOKEN not configured');
    return false;
  }

  const phoneNumberId = await resolvePhoneNumberId(prisma, storeId);
  if (!phoneNumberId) {
    console.error('No WhatsApp phone number ID available', { storeId });
    return false;
  }

  try {
    await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        // Groups are addressed by group id with recipient_type "group"; people by phone number.
        ...(target.group ? { recipient_type: 'group', to: target.to } : { to: target.to.replace(/^\+/, '') }),
        type: 'text',
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return true;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to send WhatsApp message', { to: target.to, group: target.group, storeId, error: msg });
    return false;
  }
}

export async function sendWhatsAppMessage(
  prisma: PrismaClient,
  to: string,
  message: string,
  storeId?: string
): Promise<boolean> {
  return postText(prisma, { to, group: false }, message, storeId);
}

/** Post to one of the store's WhatsApp groups. */
export async function sendWhatsAppGroupMessage(
  prisma: PrismaClient,
  groupId: string,
  message: string,
  storeId?: string
): Promise<boolean> {
  return postText(prisma, { to: groupId, group: true }, message, storeId);
}

/**
 * Groups that should see this store's notes.
 *
 * Usual case: the store's own linked chat.
 * Rare case: two stores (Rockaway + Denville) share one group, linked only to the home store —
 * if this store has no group of its own and the owner has exactly one other group, reuse it.
 * Sales still land on each store's own id from the name in the message.
 */
async function groupsForStore(
  prisma: PrismaClient,
  storeId: string
): Promise<Array<{ whatsappGroupId: string }>> {
  const own = await prisma.storeWhatsAppGroup.findMany({ where: { storeId, active: true } });
  if (own.length > 0) return own;

  const owners = await prisma.userStore.findMany({ where: { storeId, role: 'OWNER' }, select: { userId: true } });
  if (owners.length === 0) return [];
  const siblings = await prisma.userStore.findMany({
    where: { userId: { in: owners.map((o) => o.userId) }, role: 'OWNER' },
    select: { storeId: true },
  });
  const otherIds = [...new Set(siblings.map((s) => s.storeId).filter((id) => id !== storeId))];
  if (otherIds.length === 0) return [];
  const shared = await prisma.storeWhatsAppGroup.findMany({ where: { storeId: { in: otherIds }, active: true } });
  const unique = [...new Set(shared.map((g) => g.whatsappGroupId))];
  if (unique.length !== 1) return [];
  return [{ whatsappGroupId: unique[0] }];
}

/** Post to every active group linked to a store. Returns how many posts went out. Never throws. */
export async function postToStoreGroups(prisma: PrismaClient, storeId: string, message: string): Promise<number> {
  try {
    const groups = await groupsForStore(prisma, storeId);
    let posted = 0;
    for (const group of groups) {
      if (await sendWhatsAppGroupMessage(prisma, group.whatsappGroupId, message, storeId)) posted += 1;
    }
    return posted;
  } catch (error) {
    console.error('Could not post to store groups', { storeId, error: error instanceof Error ? error.message : error });
    return 0;
  }
}
