import { logger } from '../utils/logger';
import { resolveStore } from '../services/storeResolution';
import { classifyMessage } from '../services/classifier';
import { extractData } from '../services/extraction';
import { processWhatsAppMedia } from '../services/mediaHandler';
import { createPendingAction } from '../services/pendingActions';
import { sendConfirmationMessage } from '../services/whatsappBot';
import { logMessage, updateMessageLog, isMessageProcessed } from '../services/messageLogger';
import { ClassificationType } from '../types';

export interface ProcessMessageJobData {
  messageId: string;
  phoneE164: string;
  messageText?: string;
  mediaId?: string;
  mediaType?: string;
}

/**
 * Main message processing job
 */
export async function processMessageJob(data: ProcessMessageJobData): Promise<void> {
  const { messageId, phoneE164, messageText, mediaId, mediaType } = data;

  try {
    // Check idempotency
    if (await isMessageProcessed(messageId)) {
      logger.info('Message already processed', { messageId });
      return;
    }

    // Step 1: Log message
    await logMessage({
      messageId,
      phoneE164,
      messageType: mediaId ? mediaType || 'image' : 'text',
      messageText,
      mediaId,
    });

    // Step 2: Resolve store
    const storeResolution = await resolveStore(phoneE164, messageText);

    if (storeResolution.isUnlinked) {
      await sendConfirmationMessage(
        phoneE164,
        '📱 Store not linked.\n\nReply STORE S001 to link your number to a store.',
        ''
      );
      await updateMessageLog(messageId, { processed: true });
      return;
    }

    const storeId = storeResolution.storeId!;

    // Step 3: Handle media if present
    let imageBuffer: Buffer | undefined;
    let imageUrl: string | undefined;

    if (mediaId && mediaType?.includes('image')) {
      try {
        const mediaResult = await processWhatsAppMedia(mediaId, storeId, messageId, mediaType);
        imageBuffer = mediaResult.buffer;
        imageUrl = mediaResult.s3Url;

        await updateMessageLog(messageId, { mediaUrl: imageUrl });
      } catch (error: any) {
        logger.error('Media processing failed', {
          error: error.message,
          messageId,
        });
        // Continue processing with text only
      }
    }

    // Step 4: Classify message
    const classification = await classifyMessage(messageText || '', true); // Use AI fallback

    if (classification.type === ClassificationType.UNKNOWN) {
      await sendConfirmationMessage(
        phoneE164,
        '❓ Could not classify message. Please try again with clearer details.',
        ''
      );
      await updateMessageLog(messageId, {
        classification: ClassificationType.UNKNOWN,
        processed: true,
      });
      return;
    }

    await updateMessageLog(messageId, { classification: classification.type });

    // Step 5: Extract structured data
    const extraction = await extractData(
      classification.type,
      messageText || '',
      imageUrl,
      imageBuffer
    );

    await updateMessageLog(messageId, {
      extractedData: extraction.fields,
    });

    // Step 6: Create pending action
    const actionId = await createPendingAction(
      phoneE164,
      storeId,
      classification.type,
      extraction,
      messageId
    );

    // Step 7: Send confirmation message
    const summary = formatExtractionSummary(classification.type, extraction.fields);
    await sendConfirmationMessage(phoneE164, summary, actionId);

    // Mark as processed
    await updateMessageLog(messageId, { processed: true });

    logger.info('Message processed successfully', {
      messageId,
      storeId,
      classification: classification.type,
    });
  } catch (error: any) {
    logger.error('Message processing failed', {
      error: error.message,
      stack: error.stack,
      messageId,
    });
    throw error; // Re-throw to trigger retry
  }
}

/**
 * Format extraction summary for WhatsApp message
 */
function formatExtractionSummary(type: ClassificationType, fields: any): string {
  switch (type) {
    case ClassificationType.ORDER_REQUEST:
      const vendors = fields.vendor_groups || [];
      const itemCount = vendors.reduce(
        (sum: number, v: any) => sum + (v.items?.length || 0),
        0
      );
      return `📦 Order Request Detected\n\n${vendors.length} vendor(s), ${itemCount} item(s)\n\nReply OK to confirm, FIX to correct, or CANCEL to reject.`;

    case ClassificationType.INVOICE_EXPENSE:
      return `🧾 Invoice/Expense Detected\n\nVendor: ${fields.vendor || 'N/A'}\nAmount: $${fields.amount || 0}\nDate: ${fields.invoice_date || 'N/A'}\n\nReply OK to confirm, FIX to correct, or CANCEL to reject.`;

    case ClassificationType.STORE_SALES:
      return `💰 Store Sales Detected\n\nCash: $${fields.cash || 0}\nCard: $${fields.card || 0}\nTax: $${fields.tax || 0}\nTotal: $${fields.total_inside || 0}\n\nReply OK to confirm, FIX to correct, or CANCEL to reject.`;

    case ClassificationType.FUEL_SALES:
      return `⛽ Fuel Sales Detected\n\nGallons: ${fields.gallons || 0}\nSales: $${fields.fuel_sales || 0}\nGP: $${fields.fuel_gp || 0}\n\nReply OK to confirm, FIX to correct, or CANCEL to reject.`;

    case ClassificationType.PAID_OUT:
      return `💸 Paid Out Detected\n\nAmount: $${fields.amount || 0}\nReason: ${fields.reason || 'N/A'}\nEmployee: ${fields.employee || 'N/A'}\n\nReply OK to confirm, FIX to correct, or CANCEL to reject.`;

    default:
      return `📋 Entry Detected\n\n${JSON.stringify(fields, null, 2)}\n\nReply OK to confirm, FIX to correct, or CANCEL to reject.`;
  }
}

