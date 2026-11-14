import type { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { getWhatsAppStoreRoutingMode } from './whatsappStoreResolution';
import { logApp, logAppError, maskPhone, serializeError } from './requestLog';

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

export type SendResult = { ok: boolean; windowClosed: boolean };

/** Meta refuses free-form messages 24 hours after the person last wrote; only a template gets through. */
const WINDOW_CLOSED_CODES = new Set([131047]);

async function postPayload(
  prisma: PrismaClient,
  target: { to: string; group: boolean },
  body: Record<string, unknown>,
  storeId?: string
): Promise<SendResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('WHATSAPP_ACCESS_TOKEN not configured');
    return { ok: false, windowClosed: false };
  }

  const phoneNumberId = await resolvePhoneNumberId(prisma, storeId);
  if (!phoneNumberId) {
    console.error('No WhatsApp phone number ID available', { storeId });
    return { ok: false, windowClosed: false };
  }

  try {
    await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        // Groups are addressed by group id with recipient_type "group"; people by phone number.
        ...(target.group ? { recipient_type: 'group', to: target.to } : { to: target.to.replace(/^\+/, '') }),
        ...body,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    logApp('wa.send', {
      ok: true,
      kind: body.type,
      group: target.group,
      storeId,
      to: target.group ? `group:${target.to.slice(0, 8)}` : maskPhone(target.to),
    });
    return { ok: true, windowClosed: false };
  } catch (error: unknown) {
    const code = (error as { response?: { data?: { error?: { code?: number } } } }).response?.data?.error?.code;
    logAppError('wa.send', {
      ok: false,
      kind: body.type,
      group: target.group,
      storeId,
      to: target.group ? `group:${target.to.slice(0, 8)}` : maskPhone(target.to),
      ...serializeError(error),
    });
    return { ok: false, windowClosed: typeof code === 'number' && WINDOW_CLOSED_CODES.has(code) };
  }
}

async function postText(
  prisma: PrismaClient,
  target: { to: string; group: boolean },
  message: string,
  storeId?: string
): Promise<boolean> {
  return (await postPayload(prisma, target, { type: 'text', text: { body: message } }, storeId)).ok;
}

/** A message with up to three reply buttons. Each tap comes back as the button's id. */
export async function sendWhatsAppButtons(
  prisma: PrismaClient,
  to: string,
  message: string,
  buttons: Array<{ id: string; title: string }>,
  storeId?: string
): Promise<SendResult> {
  if (message.length > 1024) {
    return { ok: await sendWhatsAppMessage(prisma, to, message, storeId), windowClosed: false };
  }
  return postPayload(
    prisma,
    { to, group: false },
    {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: message },
        action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })) },
      },
    },
    storeId
  );
}

/**
 * An approved template (the only thing Meta delivers outside the 24-hour window).
 * `buttonPayloads` fill the template's quick-reply buttons in order; a tap comes back as that payload.
 */
export async function sendWhatsAppTemplate(
  prisma: PrismaClient,
  to: string,
  name: string,
  bodyParams: string[],
  storeId?: string,
  options: { language?: string; buttonPayloads?: string[] } = {}
): Promise<SendResult> {
  const components: Array<Record<string, unknown>> = [];
  if (bodyParams.length > 0) {
    components.push({ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) });
  }
  (options.buttonPayloads ?? []).forEach((payload, index) => {
    components.push({ type: 'button', sub_type: 'quick_reply', index: String(index), parameters: [{ type: 'payload', payload }] });
  });
  return postPayload(
    prisma,
    { to, group: false },
    {
      type: 'template',
      template: { name, language: { code: options.language ?? 'en' }, ...(components.length > 0 ? { components } : {}) },
    },
    storeId
  );
}

/**
 * First message to someone just added on Store admin. They have never written to opsAi, so only a
 * template can reach them; their reply (OK) opens the 24-hour window.
 */
export async function sendWelcomeTemplate(
  prisma: PrismaClient,
  phoneE164: string,
  store: { storeId: string; storeName: string }
): Promise<boolean> {
  const welcome = await sendWhatsAppTemplate(prisma, phoneE164, 'team_welcome', [store.storeName], store.storeId);
  if (welcome.ok) return true;
  return (await sendWhatsAppTemplate(prisma, phoneE164, 'store_connected', [], store.storeId)).ok;
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

  const owners = (await prisma.userStore.findMany({ where: { storeId }, select: { userId: true, role: true } })).filter(
    (row) => row.role === 'OWNER'
  );
  if (owners.length === 0) return [];
  const siblings = (
    await prisma.userStore.findMany({
      where: { userId: { in: owners.map((o) => o.userId) } },
      select: { storeId: true, role: true },
    })
  ).filter((row) => row.role === 'OWNER');
  const otherIds = [...new Set(siblings.map((s) => s.storeId).filter((id) => id !== storeId))];
  if (otherIds.length === 0) return [];
  const shared = await prisma.storeWhatsAppGroup.findMany({ where: { storeId: { in: otherIds }, active: true } });
  const unique = [...new Set(shared.map((g) => g.whatsappGroupId))];
  if (unique.length !== 1) return [];
  return [{ whatsappGroupId: unique[0] }];
}

const E164 = /^\+[1-9]\d{6,14}$/;

export function isSendableWhatsAppPhone(value: string | null | undefined): boolean {
  return Boolean(value && E164.test(value.trim()));
}

/**
 * Owner/manager WhatsApp numbers for this store. Extra locations often have no directory row
 * of their own (the phone lives on the first store), so we also look at sibling stores.
 */
export async function managerPhonesForStore(prisma: PrismaClient, storeId: string): Promise<string[]> {
  const own = await prisma.userDirectory.findMany({
    where: { storeId, isActive: true },
    select: { phoneE164: true, role: true },
  });
  const local = [
    ...new Set(
      own
        .filter((row) => row.role === 'OWNER' || row.role === 'MANAGER')
        .map((row) => row.phoneE164)
        .filter(isSendableWhatsAppPhone)
    ),
  ];
  if (local.length > 0) return local;

  const members = await prisma.userStore.findMany({ where: { storeId }, select: { userId: true, role: true } });
  const userIds = members.filter((row) => row.role === 'OWNER' || row.role === 'MANAGER').map((row) => row.userId);
  if (userIds.length === 0) return [];
  const sibling = await prisma.userStore.findMany({
    where: { userId: { in: userIds } },
    select: { storeId: true },
  });
  const storeIds = [...new Set(sibling.map((row) => row.storeId))];
  if (storeIds.length === 0) return [];
  const directory = await prisma.userDirectory.findMany({
    where: { isActive: true, storeId: { in: storeIds }, role: { in: ['OWNER', 'MANAGER'] } },
    select: { phoneE164: true },
  });
  return [...new Set(directory.map((row) => row.phoneE164).filter(isSendableWhatsAppPhone))];
}

/** Post to every active group linked to a store. Returns how many posts went out. Never throws. */
export async function postToStoreGroups(
  prisma: PrismaClient,
  storeId: string,
  message: string,
  extraGroupId?: string | null
): Promise<number> {
  try {
    const groups = await groupsForStore(prisma, storeId);
    const ids = [
      ...new Set(
        [...groups.map((g) => g.whatsappGroupId), extraGroupId?.trim()].filter((id): id is string => Boolean(id))
      ),
    ];
    let posted = 0;
    for (const id of ids) {
      if (await sendWhatsAppGroupMessage(prisma, id, message, storeId)) posted += 1;
    }
    return posted;
  } catch (error) {
    console.error('Could not post to store groups', { storeId, error: error instanceof Error ? error.message : error });
    return 0;
  }
}

export type StoreDelivery = { posted: number; via: 'group' | 'direct' | 'none' };

/**
 * Group first when one is linked. With no group (1:1 testing, extra store on the same dashboard),
 * send to the owner/manager WhatsApp — including the phone on a sibling store.
 */
export async function deliverStoreMessage(
  prisma: PrismaClient,
  storeId: string,
  message: string,
  extra?: { extraGroupId?: string | null; extraPhone?: string | null; directMessage?: string | null }
): Promise<StoreDelivery> {
  try {
    const groupPosted = await postToStoreGroups(prisma, storeId, message, extra?.extraGroupId);
    if (groupPosted > 0) return { posted: groupPosted, via: 'group' };

    const phones = new Set(await managerPhonesForStore(prisma, storeId));
    const extraPhone = extra?.extraPhone?.trim();
    if (isSendableWhatsAppPhone(extraPhone)) phones.add(extraPhone as string);

    const direct = extra?.directMessage?.trim() || message;
    let sent = 0;
    for (const phone of phones) {
      if (await sendWhatsAppMessage(prisma, phone, direct, storeId)) sent += 1;
    }
    if (sent > 0) return { posted: sent, via: 'direct' };
    return { posted: 0, via: 'none' };
  } catch (error) {
    console.error('Could not deliver store message', { storeId, error: error instanceof Error ? error.message : error });
    return { posted: 0, via: 'none' };
  }
}
