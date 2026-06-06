import type { PrismaClient } from '@prisma/client';
import { ClassificationType } from '@prisma/client';
import { classifyMessage } from './messageClassifier';
import { extractDataFromText } from './messageExtraction';
import { isMessageProcessed, logMessage, updateMessageLog } from './messageLogService';
import { createPendingAction } from './pendingActionService';
import {
  resolveStoreIdBySenderPhone,
  tryAutoLinkGroupFromSender,
} from './autoLinkWhatsAppGroup';
import { resolveStoreIdForIncomingMessage } from './whatsappStoreResolution';
import { handleWhatsAppCommand, isWhatsAppCommand } from './whatsappCommands';
import { sendWhatsAppMessage } from './whatsappMessaging';

export interface ProcessWhatsAppMessageInput {
  messageId: string;
  phoneE164: string;
  messageText?: string;
  mediaId?: string;
  mediaType?: string;
  storeId?: string | null;
  groupId?: string | null;
  phoneNumberId?: string | null;
}

function formatExtractionSummary(type: ClassificationType, fields: Record<string, unknown>): string {
  switch (type) {
    case ClassificationType.ORDER_REQUEST:
      return '📦 Order detected\n\nReply OK to confirm, FIX to correct, or CANCEL to reject.';
    case ClassificationType.INVOICE_EXPENSE:
      return `🧾 Invoice/Expense\nVendor: ${fields.vendor || 'N/A'}\nAmount: $${fields.amount || 0}\n\nReply OK to confirm, FIX to correct, or CANCEL to reject.`;
    case ClassificationType.STORE_SALES:
      return `💰 Store Sales\nCash: $${fields.cash || 0}\nCard: $${fields.card || 0}\nTotal: $${fields.total_inside || 0}\n\nReply OK to confirm, FIX to correct, or CANCEL to reject.`;
    case ClassificationType.FUEL_SALES:
      return `⛽ Fuel Sales\nGallons: ${fields.gallons || 0}\nSales: $${fields.fuel_sales || 0}\n\nReply OK to confirm, FIX to correct, or CANCEL to reject.`;
    case ClassificationType.PAID_OUT:
      return `💸 Paid Out\nAmount: $${fields.amount || 0}\n\nReply OK to confirm, FIX to correct, or CANCEL to reject.`;
    default:
      return '📋 Entry detected\n\nReply OK to confirm, FIX to correct, or CANCEL to reject.';
  }
}

/**
 * Process one inbound WhatsApp message (shared by Vercel webhook and Express worker).
 */
export async function processWhatsAppMessage(
  prisma: PrismaClient,
  input: ProcessWhatsAppMessageInput
): Promise<void> {
  const { messageId, phoneE164, messageText = '', mediaId, mediaType } = input;

  if (await isMessageProcessed(prisma, messageId)) {
    return;
  }

  let storeId = input.storeId ?? null;
  let groupJustLinked = false;

  if (!storeId) {
    const resolved = await resolveStoreIdForIncomingMessage(
      prisma,
      input.groupId ?? null,
      input.phoneNumberId ?? null
    );
    storeId = resolved.storeId;
  }

  if (!storeId && input.groupId) {
    const linked = await tryAutoLinkGroupFromSender(prisma, input.groupId, phoneE164);
    if (linked) {
      storeId = linked.storeId;
      groupJustLinked = linked.linked;
    }
  }

  if (!storeId) {
    storeId = await resolveStoreIdBySenderPhone(prisma, phoneE164);
  }

  const text = messageText.trim();

  if (text && isWhatsAppCommand(text)) {
    await logMessage(prisma, {
      messageId,
      phoneE164,
      storeId,
      messageType: 'text',
      messageText: text,
    });

    const result = await handleWhatsAppCommand(prisma, phoneE164, text);
    await sendWhatsAppMessage(prisma, phoneE164, result.message, result.storeId ?? storeId ?? undefined);
    await updateMessageLog(prisma, messageId, { processed: true, storeId: storeId ?? undefined });
    return;
  }

  await logMessage(prisma, {
    messageId,
    phoneE164,
    storeId,
    messageType: mediaId ? mediaType || 'image' : 'text',
    messageText: text || undefined,
    mediaId,
  });

  if (!storeId) {
    await sendWhatsAppMessage(
      prisma,
      phoneE164,
      '📱 Store not linked.\n\nComplete onboarding at opsAi, then create your ops WhatsApp group, add our business number, and message from your registered phone.',
      undefined
    );
    await updateMessageLog(prisma, messageId, { processed: true });
    return;
  }

  if (groupJustLinked) {
    await sendWhatsAppMessage(
      prisma,
      phoneE164,
      `✅ ops group connected to your store (${storeId}).\n\nSend sales, invoices, or photos here. Reply HELP for commands.`,
      storeId
    );
  }

  if (!text && !mediaId) {
    await sendWhatsAppMessage(
      prisma,
      phoneE164,
      'Send a photo or text with sales, invoice, order, or fuel details. Reply HELP for commands.',
      storeId
    );
    await updateMessageLog(prisma, messageId, { processed: true, storeId });
    return;
  }

  const classification = classifyMessage(text || 'image receipt');
  if (classification.type === ClassificationType.UNKNOWN) {
    await sendWhatsAppMessage(
      prisma,
      phoneE164,
      '❓ Could not classify message. Try clearer text like "Sales cash 2100 card 5400" or a receipt photo with a caption. Reply HELP for examples.',
      storeId
    );
    await updateMessageLog(prisma, messageId, {
      classification: ClassificationType.UNKNOWN,
      processed: true,
      storeId,
    });
    return;
  }

  const extraction = extractDataFromText(classification.type, text || 'image');
  const actionId = await createPendingAction(
    prisma,
    phoneE164,
    storeId,
    classification.type,
    extraction.fields,
    extraction.confidence,
    messageId
  );

  const summary = formatExtractionSummary(classification.type, extraction.fields);
  await sendWhatsAppMessage(prisma, phoneE164, `${summary}\n\nRef: ${actionId.slice(0, 8)}`, storeId);

  await updateMessageLog(prisma, messageId, {
    classification: classification.type,
    extractedData: extraction.fields,
    processed: true,
    storeId,
  });
}
