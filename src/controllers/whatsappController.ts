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

      // Log messages
      if (value?.messages) {
        logger.info('Messages received', {
          messageCount: value.messages.length,
        });

        for (const message of value.messages) {
          await processIncomingMessage(message);
        }
      }

      // Log status updates (optional)
      if (value?.statuses) {
        logger.info('Status updates received', {
          statusCount: value.statuses.length,
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
 * Simplified for Step 1 - just log the message for testing
 */
async function processIncomingMessage(message: any) {
  const messageId = message.id;
  const phoneE164 = `+${message.from}`;
  const messageType = message.type;
  const text = message.text?.body || '';
  const imageId = message.image?.id || null;

  logger.info('📱 WhatsApp Message Received', {
    messageId,
    phoneE164,
    messageType,
    text: text.substring(0, 100), // Log first 100 chars
    imageId,
    timestamp: new Date().toISOString(),
    fullMessage: JSON.stringify(message, null, 2), // Log full message for debugging
  });

  // For Step 1, we're just logging - no processing yet
  // This confirms webhook is working correctly
  // TODO: Add message processing logic in next steps
}

