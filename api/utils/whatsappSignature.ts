import crypto from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Verify Meta webhook X-Hub-Signature-256.
 * Returns true if valid; sends 401 and returns false otherwise.
 */
export function verifyWhatsAppWebhookSignature(req: VercelRequest, res: VercelResponse): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  const isProd =
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL_ENV === 'production';

  if (!appSecret) {
    if (isProd) {
      console.error('WHATSAPP_APP_SECRET is required in production');
      res.status(500).json({ error: 'Webhook verification not configured' });
      return false;
    }
    return true;
  }

  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  if (!signature) {
    res.status(401).json({ error: 'Missing signature' });
    return false;
  }

  const payload = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', appSecret).update(payload).digest('hex');
  const provided = signature.replace(/^sha256=/, '');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    res.status(401).json({ error: 'Invalid signature' });
    return false;
  }

  return true;
}
