import { Request, Response } from 'express';
import { logger } from '../utils/logger';

// Webhook verification (Meta challenge)
export const verifyWebhook = (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('Webhook verified');
    res.status(200).send(challenge);
  } else {
    logger.warn('Webhook verification failed');
    res.sendStatus(403);
  }
};

// Webhook message handler
export const handleWebhook = async (req: Request, res: Response) => {
  try {
    const body = req.body;

    // Log the full webhook payload for debugging
    logger.info('Webhook received', {
      object: body.object,
      entryCount: body.entry?.length || 0,
    });

    // Respond immediately to WhatsApp (200 OK) - IMPORTANT!
    res.status(200).send('OK');

    // Process webhook asynchronously
    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      // Extract phone number ID from webhook metadata (identifies which store's number)
      const phoneNumberId = value?.metadata?.phone_number_id || null;

      // Log messages
      if (value?.messages) {
        logger.info('Messages received', {
          messageCount: value.messages.length,
          phoneNumberId,
        });

        for (const message of value.messages) {
          await processIncomingMessage(message, phoneNumberId);
        }
      }

      // Log status updates (optional)
      if (value?.statuses) {
        logger.info('Status updates received', {
          statusCount: value.statuses.length,
          phoneNumberId,
        });
      }
    }
  } catch (error: any) {
    logger.error('Error handling webhook:', error);
    // Still return 200 to WhatsApp even on error
    res.status(200).send('OK');
  }
};

/**
 * Process incoming WhatsApp message
 * @param message - WhatsApp message object
 * @param phoneNumberId - Phone number ID from webhook (identifies which store's number)
 */
async function processIncomingMessage(message: any, phoneNumberId: string | null) {
  const messageId = message.id;
  const phoneE164 = `+${message.from}`;
  const messageType = message.type;
  const text = message.text?.body || '';
  const imageId = message.image?.id || null;

  // Resolve store from phone number ID (shared Meta account)
  let storeId: string | null = null;
  if (phoneNumberId) {
    try {
      const { prisma } = await import('../config/database');
      const store = await prisma.storeConfig.findFirst({
        where: { whatsappPhoneNumberId: phoneNumberId },
        select: { storeId: true },
      });
      storeId = store?.storeId || null;
    } catch (error: any) {
      logger.error('Failed to resolve store from phone number ID', {
        phoneNumberId,
        error: error.message,
      });
    }
  }

  logger.info('📱 WhatsApp Message Received', {
    messageId,
    phoneE164,
    phoneNumberId,
    storeId,
    messageType,
    text: text.substring(0, 100), // Log first 100 chars
    imageId,
    timestamp: new Date().toISOString(),
  });

  // Queue message for processing (existing logic)
  try {
    const { addToMessageQueue } = await import('../queues/messageQueue');
    await addToMessageQueue({
      messageId,
      phoneE164,
      messageText: text || undefined,
      mediaId: imageId || undefined,
      mediaType: messageType === 'image' ? 'image/jpeg' : undefined,
      storeId: storeId || undefined, // Pass storeId if resolved from phone number
    });
  } catch (error: any) {
    logger.error('Failed to queue message', {
      error: error.message,
      messageId,
    });
  }
}

