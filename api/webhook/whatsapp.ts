import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { applyGroupLifecycleEvent } from '../lib/whatsappGroupLifecycle';
import { verifyWhatsAppWebhookSignature } from '../utils/whatsappSignature';
import { processWhatsAppMessage } from '../../lib/processWhatsAppMessage';

const prisma = new PrismaClient();

// Webhook verification (Meta challenge)
function verifyWebhook(req: VercelRequest, res: VercelResponse) {
  const mode = req.query['hub.mode'] as string;
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  console.log('🔍 Webhook verification attempt', {
    mode,
    tokenReceived: token ? '***' : 'missing',
    tokenExpected: verifyToken ? '***' : 'missing',
    challenge: challenge ? 'present' : 'missing',
  });

  if (!verifyToken) {
    console.error('❌ WHATSAPP_WEBHOOK_VERIFY_TOKEN not set in environment variables');
    res.status(500).send('Server configuration error');
    return;
  }

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('✅ Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.warn('❌ Webhook verification failed', {
      mode,
      tokenMatch: token === verifyToken,
      modeMatch: mode === 'subscribe',
    });
    res.status(403).send('Forbidden');
  }
}

async function handleWebhook(req: VercelRequest, res: VercelResponse) {
  try {
    const body = req.body;

    console.log('📨 Webhook received', {
      object: body.object,
      entryCount: body.entry?.length || 0,
    });

    res.status(200).send('OK');

    if (body.object === 'whatsapp_business_account' && Array.isArray(body.entry)) {
      for (const entry of body.entry) {
        const changes = Array.isArray(entry.changes) ? entry.changes : [];
        for (const change of changes) {
          const value = change.value;
          const phoneNumberId = (value?.metadata?.phone_number_id as string) || null;

          if (change.field === 'group_lifecycle_update' && Array.isArray(value?.groups)) {
            try {
              for (const g of value.groups) {
                await applyGroupLifecycleEvent(prisma, g as Record<string, unknown>);
              }
            } catch (e) {
              console.error('group_lifecycle_update handling failed', e);
            }
          }

          if (value?.messages) {
            console.log('📱 Messages received', {
              messageCount: value.messages.length,
              phoneNumberId,
            });

            for (const message of value.messages) {
              const messageId = message.id as string;
              const phoneE164 = `+${message.from}`;
              const messageType = message.type as string;
              const text = (message.text as { body?: string } | undefined)?.body || '';
              const groupId = (message as { group_id?: string }).group_id ?? null;
              const imageId = (message.image as { id?: string } | undefined)?.id;

              try {
                await processWhatsAppMessage(prisma, {
                  messageId,
                  phoneE164,
                  messageText: text || undefined,
                  mediaId: imageId || undefined,
                  mediaType: messageType === 'image' ? 'image/jpeg' : messageType,
                  groupId,
                  phoneNumberId,
                });
              } catch (err) {
                console.error('Message processing failed', {
                  messageId,
                  error: err instanceof Error ? err.message : err,
                });
              }
            }
          }

          if (value?.statuses) {
            console.log('📊 Status updates received', {
              statusCount: value.statuses.length,
            });
          }
        }
      }
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Error handling webhook:', errorMessage);
    res.status(200).send('OK');
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === 'GET') {
    verifyWebhook(req, res);
    return;
  }

  if (req.method === 'POST') {
    if (!verifyWhatsAppWebhookSignature(req, res)) return;
    await handleWebhook(req, res);
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
