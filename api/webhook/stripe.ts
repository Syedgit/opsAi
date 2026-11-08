import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PrismaClient } from '@prisma/client';
import { applyStripeEvent, getStripe } from '../../lib/billing/stripeActions';
import { stripeConfig, type StripeObject } from '../../lib/billing/stripe';
import { readRawBody } from '../../lib/whatsappSignature';
import { logApp, logAppError, loggedHandler, serializeError } from '../../lib/requestLog';

const prisma = new PrismaClient();

/** Stripe signs the raw bytes. Do not parse JSON before this handler. */
export const config = { api: { bodyParser: false } };

async function rawBody(req: VercelRequest): Promise<string> {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  return readRawBody(req);
}

async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const cfg = stripeConfig();
  const stripe = getStripe();
  if (!cfg.webhookReady || !stripe) {
    res.status(503).json({ error: 'Stripe webhook is not configured' });
    return;
  }

  const signature = req.headers['stripe-signature'];
  if (typeof signature !== 'string' || !signature) {
    res.status(400).json({ error: 'Missing stripe-signature' });
    return;
  }

  let type = '';
  let object: StripeObject = {};
  try {
    const raw = await rawBody(req);
    const event = stripe.webhooks.constructEvent(raw, signature, cfg.webhookSecret);
    type = event.type;
    object = event.data.object as unknown as StripeObject;
  } catch (error: unknown) {
    logAppError('stripe.webhook.sig', serializeError(error));
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  try {
    const result = await applyStripeEvent(prisma, type, object);
    logApp('stripe.webhook', { type, applied: result.applied, ignored: result.ignored });
    res.json({ received: true, ...result });
  } catch (error: unknown) {
    logAppError('stripe.webhook', serializeError(error));
    res.status(500).json({ error: 'Webhook failed' });
  }
}

export default loggedHandler('stripe.webhook', handler);
