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
import { routeIntent } from './understanding/intent';
import { tryTaskEvidence } from './tasks/evidence';
import { checkAiBudget } from './understanding/budget';

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

  // Voice notes are ignored completely: no reply, no download, no AI.
  if (mediaId && mediaType?.toLowerCase().startsWith('audio')) {
    await updateMessageLog(prisma, messageId, { classification: 'AUDIO_IGNORED', processed: true, storeId: storeId ?? undefined });
    return;
  }

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

  // Replies to shift tasks ("2 190F", a photo with caption 3) are proof for a task, not store data.
  try {
    const member = await prisma.userDirectory.findUnique({ where: { phoneE164 }, select: { role: true } });
    const handled = await tryTaskEvidence(prisma, {
      messageId,
      phoneE164,
      storeId,
      text,
      mediaId,
      groupId: input.groupId ?? null,
      role: member?.role ?? null,
    });
    if (handled) return;
  } catch (error) {
    // Tasks must never stop normal reporting (for example while the tables are not created yet).
    console.error('Task evidence check failed', { messageId, error: error instanceof Error ? error.message : error });
  }

  // Intent (code) → reason (one AI read, only if needed) → execute (always code).
  const intent = routeIntent({ text, hasMedia: Boolean(mediaId) });

  if (intent.layer === 'execute' && (intent.action === 'chatter' || intent.action === 'no_data')) {
    if (intent.reply) await sendWhatsAppMessage(prisma, phoneE164, intent.reply, storeId);
    await updateMessageLog(prisma, messageId, { classification: intent.classification, processed: true, storeId });
    return;
  }

  if (intent.layer === 'execute' && intent.action === 'rules') {
    await executeRuleExtraction(prisma, {
      messageId,
      phoneE164,
      storeId,
      type: intent.type,
      fields: intent.fields,
      confidence: intent.confidence,
    });
    return;
  }

  // Reasoning: photos, invoices (due dates), order lists, leftover numbers, equipment. Not reminders or alerts.
  const understander = createOpenAiUnderstander();
  let aiAllowed = true;
  if (understander) {
    const budget = await checkAiBudget(prisma, storeId);
    if (!budget.allowed) {
      aiAllowed = false;
      if (budget.notify) {
        await sendWhatsAppMessage(
          prisma,
          phoneE164,
          '⏳ This store has used today\'s smart-reading budget. Typed numbers like "cash 298 card 1355 gas 1440" still work. Photos work again tomorrow.',
          storeId
        );
        await prisma.messageLog
          .create({
            data: {
              messageId: `ai-limit:${storeId}:${messageId}`,
              phoneE164,
              storeId,
              messageType: 'system',
              classification: 'AI_LIMIT',
              processed: true,
            },
          })
          .catch((error: unknown) => console.error('Could not record AI limit notice', error instanceof Error ? error.message : error));
      }
      if (mediaId) {
        await updateMessageLog(prisma, messageId, { classification: 'AI_LIMIT', processed: true, storeId });
        return;
      }
    }
  }

  if (understander && aiAllowed) {
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
  }

  await executeRuleExtraction(prisma, { messageId, phoneE164, storeId, text });
}

async function executeRuleExtraction(
  prisma: PrismaClient,
  args: {
    messageId: string;
    phoneE164: string;
    storeId: string;
    text?: string;
    type?: ClassificationType;
    fields?: Record<string, unknown>;
    confidence?: number;
  }
): Promise<void> {
  const type = args.type ?? classifyMessage(args.text || 'image receipt').type;
  if (type === ClassificationType.UNKNOWN) {
    await sendWhatsAppMessage(
      prisma,
      args.phoneE164,
      '❓ Could not classify message. Try clearer text like "Sales cash 2100 card 5400" or a receipt photo with a caption. Reply HELP for examples.',
      args.storeId
    );
    await updateMessageLog(prisma, args.messageId, {
      classification: ClassificationType.UNKNOWN,
      processed: true,
      storeId: args.storeId,
    });
    return;
  }

  const fields = args.fields ?? extractDataFromText(type, args.text || 'image').fields;
  const confidence = args.confidence ?? 0.6;
  if (args.text) {
    const left = unusedNumbers(type, args.text, fields);
    if (left.length > 0) {
      await sendWhatsAppMessage(
        prisma,
        args.phoneE164,
        `😕 I can't read all of that right now (I would have left out: ${left.join(', ')}). Please send it again in a minute, or send one store at a time like: cash 298 card 1355.`,
        args.storeId
      );
      await updateMessageLog(prisma, args.messageId, {
        classification: 'RULES_INCOMPLETE',
        processed: true,
        storeId: args.storeId,
      });
      return;
    }
  }

  const actionId = await createPendingAction(
    prisma,
    args.phoneE164,
    args.storeId,
    type,
    fields,
    confidence,
    args.messageId
  );
  const summary = formatExtractionSummary(type, fields);
  await sendWhatsAppMessage(prisma, args.phoneE164, `${summary}\n\nRef: ${actionId.slice(0, 8)}`, args.storeId);
  await updateMessageLog(prisma, args.messageId, {
    classification: type,
    extractedData: fields,
    processed: true,
    storeId: args.storeId,
  });
}
