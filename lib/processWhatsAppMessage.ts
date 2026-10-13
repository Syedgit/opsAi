import type { PrismaClient } from '@prisma/client';
import { ClassificationType } from '@prisma/client';
import { classifyMessage } from './messageClassifier';
import { extractDataFromText, unusedNumbers } from './messageExtraction';
import { claimMessage, logMessage, updateMessageLog } from './messageLogService';
import { checkHourlyLimit, shouldReplyNotLinked } from './rateLimit';
import { createPendingAction } from './pendingActionService';
import {
  resolveStoreIdBySenderPhone,
  tryAutoLinkGroupFromSender,
} from './autoLinkWhatsAppGroup';
import { resolveStoreIdForIncomingMessage } from './whatsappStoreResolution';
import { handleWhatsAppCommand, isWhatsAppCommand } from './whatsappCommands';
import { sendWhatsAppMessage } from './whatsappMessaging';
import { createOpenAiUnderstander } from './understanding/extractor';
import { understandAndRespond } from './understanding/service';

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

  // Only one worker may process a message, even if Meta delivers it twice.
  const claimed = await claimMessage(prisma, {
    messageId,
    phoneE164,
    messageType: mediaId ? mediaType || 'image' : 'text',
    messageText: messageText.trim() || undefined,
    mediaId,
  });
  if (!claimed) {
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
    // One reply per stranger per day; every reply costs money and an open number attracts spam.
    if (await shouldReplyNotLinked(prisma, phoneE164)) {
      await sendWhatsAppMessage(
        prisma,
        phoneE164,
        '📱 Store not linked.\n\nComplete onboarding at opsAi, then create your ops WhatsApp group, add our business number, and message from your registered phone.',
        undefined
      );
    }
    await updateMessageLog(prisma, messageId, { classification: 'NOT_LINKED', processed: true });
    return;
  }

  const limit = await checkHourlyLimit(prisma, phoneE164);
  if (!limit.allowed) {
    if (limit.notify) {
      await sendWhatsAppMessage(
        prisma,
        phoneE164,
        '⏳ That is a lot of messages in a short time. Please wait a little and send the rest later.',
        storeId
      );
    }
    await updateMessageLog(prisma, messageId, { classification: 'RATE_LIMITED', processed: true, storeId });
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

  const isAudio = Boolean(mediaId && mediaType?.toLowerCase().startsWith('audio'));

  // AI understanding (text, photos, voice). Off unless OPENAI_API_KEY and OPENAI_EXTRACTION_MODEL are set.
  const understander = createOpenAiUnderstander();
  if (understander) {
    const outcome = await understandAndRespond(prisma, {
      messageId,
      phoneE164,
      storeId,
      text,
      mediaId,
      mediaType,
      understander,
    });
    if (outcome === 'handled') return;
    // 'fallback': the AI was unreachable for a text message, so the rule-based path below handles it.
  } else if (isAudio) {
    await sendWhatsAppMessage(
      prisma,
      phoneE164,
      '🎙️ Voice notes are not switched on yet. Please send a photo or type it, like: cash 298 card 1355 gas 1440.',
      storeId
    );
    await updateMessageLog(prisma, messageId, { classification: 'AUDIO_UNSUPPORTED', processed: true, storeId });
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

  // The rules read very little. Never save (or show) a partial reading as if it were complete.
  const left = unusedNumbers(classification.type, text, extraction.fields);
  if (left.length > 0) {
    await sendWhatsAppMessage(
      prisma,
      phoneE164,
      `😕 I can't read all of that right now (I would have left out: ${left.join(', ')}). Please send it again in a minute, or send one store at a time like: cash 298 card 1355.`,
      storeId
    );
    await updateMessageLog(prisma, messageId, {
      classification: 'RULES_INCOMPLETE',
      processed: true,
      storeId,
    });
    return;
  }
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
