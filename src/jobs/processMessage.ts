import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { processWhatsAppMessage } from '../../lib/processWhatsAppMessage';

export interface ProcessMessageJobData {
  messageId: string;
  phoneE164: string;
  messageText?: string;
  mediaId?: string;
  mediaType?: string;
  storeId?: string;
  groupId?: string | null;
  phoneNumberId?: string | null;
}

/**
 * Main message processing job — delegates to shared lib pipeline.
 */
export async function processMessageJob(data: ProcessMessageJobData): Promise<void> {
  try {
    await processWhatsAppMessage(prisma, {
      messageId: data.messageId,
      phoneE164: data.phoneE164,
      messageText: data.messageText,
      mediaId: data.mediaId,
      mediaType: data.mediaType,
      storeId: data.storeId ?? null,
      groupId: data.groupId ?? null,
      phoneNumberId: data.phoneNumberId ?? null,
    });
    logger.info('Message processed', { messageId: data.messageId });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Message processing failed', {
      error: err.message,
      stack: err.stack,
      messageId: data.messageId,
    });
    throw error;
  }
}
