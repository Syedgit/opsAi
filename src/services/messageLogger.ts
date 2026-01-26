import { prisma } from '../config/database';
import { logger } from '../utils/logger';

export interface LogMessageParams {
  messageId: string;
  phoneE164: string;
  storeId?: string;
  messageType: string;
  messageText?: string;
  mediaUrl?: string;
  mediaId?: string;
  classification?: string;
  extractedData?: any;
}

/**
 * Log incoming message to database
 */
export async function logMessage(params: LogMessageParams): Promise<void> {
  try {
    await prisma.messageLog.create({
      data: {
        messageId: params.messageId,
        phoneE164: params.phoneE164,
        storeId: params.storeId || null,
        messageType: params.messageType,
        messageText: params.messageText || null,
        mediaUrl: params.mediaUrl || null,
        mediaId: params.mediaId || null,
        classification: params.classification || null,
        extractedData: params.extractedData || null,
        processed: false,
      },
    });

    logger.info('Message logged', { messageId: params.messageId });
  } catch (error: any) {
    logger.error('Failed to log message', {
      error: error.message,
      messageId: params.messageId,
    });
  }
}

/**
 * Update message log with processing results
 */
export async function updateMessageLog(
  messageId: string,
  updates: {
    classification?: string;
    extractedData?: any;
    processed?: boolean;
    mediaUrl?: string;
  }
): Promise<void> {
  try {
    await prisma.messageLog.update({
      where: { messageId },
      data: {
        ...(updates.classification && { classification: updates.classification }),
        ...(updates.extractedData && { extractedData: updates.extractedData }),
        ...(updates.processed !== undefined && { processed: updates.processed }),
        ...(updates.mediaUrl && { mediaUrl: updates.mediaUrl }),
      },
    });
  } catch (error: any) {
    logger.error('Failed to update message log', {
      error: error.message,
      messageId,
    });
  }
}

/**
 * Check if message was already processed (idempotency)
 */
export async function isMessageProcessed(messageId: string): Promise<boolean> {
  try {
    const existing = await prisma.messageLog.findUnique({
      where: { messageId },
    });

    return existing?.processed || false;
  } catch (error: any) {
    logger.error('Failed to check message processing status', {
      error: error.message,
      messageId,
    });
    return false;
  }
}

