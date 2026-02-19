import type { VercelRequest, VercelResponse } from '@vercel/node';

// Webhook verification (Meta challenge)
function verifyWebhook(req: VercelRequest, res: VercelResponse) {
  const mode = req.query['hub.mode'] as string;
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  // Log for debugging (remove sensitive data in production)
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

// Webhook message handler
async function handleWebhook(req: VercelRequest, res: VercelResponse) {
  try {
    const body = req.body;

    console.log('📨 Webhook received', {
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
        console.log('📱 Messages received', {
          messageCount: value.messages.length,
        });

        for (const message of value.messages) {
          const messageId = message.id;
          const phoneE164 = `+${message.from}`;
          const messageType = message.type;
          const text = message.text?.body || '';

          console.log('📱 WhatsApp Message Received', {
            messageId,
            phoneE164,
            messageType,
            text: text.substring(0, 100),
            timestamp: new Date().toISOString(),
          });
        }
      }

      // Log status updates (optional)
      if (value?.statuses) {
        console.log('📊 Status updates received', {
          statusCount: value.statuses.length,
        });
      }
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Error handling webhook:', errorMessage);
    // Still return 200 to WhatsApp even on error
    res.status(200).send('OK');
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === 'GET') {
    verifyWebhook(req, res);
    return;
  }
  
  if (req.method === 'POST') {
    await handleWebhook(req, res);
    return;
  }
  
  res.status(405).json({ error: 'Method not allowed' });
}

