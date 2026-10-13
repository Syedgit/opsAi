import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { applyGroupLifecycleEvent } from '../lib/whatsappGroupLifecycle';
import { waitUntil } from '@vercel/functions';
import { readRawBody, verifyRawWhatsAppSignature } from '../utils/whatsappSignature';
import { processWhatsAppMessage } from '../../lib/processWhatsAppMessage';

const prisma = new PrismaClient();

/**
 * Meta signs the raw bytes of the request, so the body must not be parsed before the signature is checked.
 * Vercel's body parser is switched off and the handler reads the stream itself.
 */
export const config = { api: { bodyParser: false } };

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processWebhookBody(body: any) {
  try {
    console.log('📨 Webhook received', {
      object: body.object,
      entryCount: body.entry?.length || 0,
    });

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
              const image = message.image as { id?: string; caption?: string } | undefined;
              const audio = message.audio as { id?: string } | undefined;
              const mediaId = image?.id || audio?.id;
              // A photo's caption is the sender's own description of it.
              const messageText = text || image?.caption || '';

              try {
                await processWhatsAppMessage(prisma, {
                  messageId,
                  phoneE164,
                  messageText: messageText || undefined,
                  mediaId: mediaId || undefined,
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
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === 'GET') {
    verifyWebhook(req, res);
    return;
  }

  if (req.method === 'POST') {
    const raw = await readRawBody(req);
    if (!verifyRawWhatsAppSignature(req, raw, res)) return;

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }

    // Answer Meta straight away (it retries slow webhooks), and keep the function alive until
    // processing finishes. Duplicate deliveries are filtered by the per-message claim.
    res.status(200).send('OK');
    const work = processWebhookBody(body);
    waitUntil(work);
    await work;
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
