import type { PrismaClient } from '@prisma/client';
import { describeEntryPayload } from './plan';
import { sendWhatsAppMessage } from '../whatsappMessaging';

/** Photos wait this long for the store's daily text (10 PM close → about noon the next day). */
export const AWAIT_TEXT_HOURS = 14;

/**
 * When the daily text never came, the photos become the close after all: the person who sent
 * them gets the numbers to confirm. Returns how many were released.
 */
export async function releaseAwaitingCloses(
  prisma: PrismaClient,
  store: { storeId: string; storeName: string },
  now: Date
): Promise<number> {
  const cutoff = new Date(now.getTime() - AWAIT_TEXT_HOURS * 60 * 60 * 1000);
  const rows = await prisma.pendingActions.findMany({
    where: {
      storeId: store.storeId,
      status: 'PENDING',
      type: 'STORE_SALES',
      createdAt: { lt: cutoff },
      payloadJson: { path: ['awaiting_text'], equals: true },
    },
  });
  let released = 0;
  for (const row of rows) {
    const { awaiting_text: _waiting, ...payload } = (row.payloadJson ?? {}) as Record<string, unknown>;
    const lines = describeEntryPayload(payload, store.storeName) ?? [`🧾 ${store.storeName}`];
    await prisma.pendingActions.update({
      where: { actionId: row.actionId },
      data: {
        payloadJson: payload as object,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      },
    });
    const text = [
      `🕐 No daily text for ${store.storeName} yet, so here is what the photos showed:`,
      '',
      ...lines,
      '',
      'Reply OK to save these numbers, FIX <field> <value> to correct, or send the daily text instead.',
    ].join('\n');
    if (await sendWhatsAppMessage(prisma, row.phoneE164, text, store.storeId)) released += 1;
  }
  return released;
}
