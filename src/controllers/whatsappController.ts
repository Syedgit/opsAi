import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { resolveStoreIdForIncomingMessage } from '../../lib/whatsappStoreResolution';
import { applyGroupLifecycleEvent } from '../../lib/whatsappGroupLifecycle';

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

    logger.info('Webhook received', {
      object: body.object,
      entryCount: body.entry?.length || 0,
    });

    res.status(200).send('OK');

    if (body.object === 'whatsapp_business_account' && Array.isArray(body.entry)) {
      for (const entry of body.entry) {
        const changes = Array.isArray(entry.changes) ? entry.changes : [];
        for (const change of changes) {
          const value = change.value;
          const phoneNumberId = value?.metadata?.phone_number_id ?? null;

          if (change.field === 'group_lifecycle_update' && Array.isArray(value?.groups)) {
            try {
              const { prisma } = await import('../config/database');
              for (const g of value.groups) {
                await applyGroupLifecycleEvent(prisma, g as Record<string, unknown>);
              }
            } catch (e: unknown) {
              logger.error('group_lifecycle_update handling failed', {
                error: e instanceof Error ? e.message : e,
              });
            }
          }

          if (value?.messages) {
            logger.info('Messages received', {
              messageCount: value.messages.length,
              phoneNumberId,
            });

            for (const message of value.messages) {
              const groupId = (message as { group_id?: string }).group_id ?? null;
              await processIncomingMessage(message, phoneNumberId, groupId);
            }
          }

          if (value?.statuses) {
            logger.info('Status updates received', {
              statusCount: value.statuses.length,
              phoneNumberId,
            });
          }
        }
      }
    }
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Error handling webhook:', err);
    res.status(200).send('OK');
  }
};

/**
 * Process incoming WhatsApp message
 * @param message - WhatsApp message object
 * @param phoneNumberId - Business phone number ID from webhook metadata
 * @param groupId - Meta group_id when message is from a group (Cloud API / Groups)
 */
async function processIncomingMessage(
  message: Record<string, unknown>,
  phoneNumberId: string | null,
  groupId: string | null
) {
  const messageId = message.id as string;
  const phoneE164 = `+${message.from}`;
  const messageType = message.type as string;
  const text = (message.text as { body?: string } | undefined)?.body || '';
  const imageId = (message.image as { id?: string } | undefined)?.id || null;

  let storeId: string | null = null;
  let resolveSource: 'group' | 'phone_number' | 'none' = 'none';
  try {
    const { prisma } = await import('../config/database');
    const resolved = await resolveStoreIdForIncomingMessage(prisma, groupId, phoneNumberId);
    storeId = resolved.storeId;
    resolveSource = resolved.source;
  } catch (error: unknown) {
    logger.error('Failed to resolve store for WhatsApp message', {
      phoneNumberId,
      groupId,
      error: error instanceof Error ? error.message : error,
    });
  }

  logger.info('📱 WhatsApp Message Received', {
    messageId,
    phoneE164,
    phoneNumberId,
    groupId,
    storeRoutingSource: resolveSource,
    storeId,
    messageType,
    text: text.substring(0, 100),
    imageId,
    timestamp: new Date().toISOString(),
  });

  try {
    const { addToMessageQueue } = await import('../queues/messageQueue');
    await addToMessageQueue({
      messageId,
      phoneE164,
      messageText: text || undefined,
      mediaId: imageId || undefined,
      mediaType: messageType === 'image' ? 'image/jpeg' : undefined,
      storeId: storeId || undefined,
      groupId,
      phoneNumberId,
    });
  } catch (error: unknown) {
    logger.error('Failed to queue message', {
      error: error instanceof Error ? error.message : error,
      messageId,
    });
  }
}
