import crypto from 'crypto';
import type { IncomingMessage } from 'http';
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Meta signs the exact bytes it sends (X-Hub-Signature-256 = HMAC-SHA256 of the raw body).
 * Re-serialising parsed JSON does not reproduce those bytes (Meta escapes accents and emoji as
 * \uXXXX, JSON.stringify does not), so the check must use the raw body.
 */

/** Read the unparsed request body. Call before anything touches req.body. */
export async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export type SignatureCheck = { ok: true } | { ok: false; status: number; error: string };

/** Pure check, easy to test. `rawBody` is the exact text Meta sent. */
export function checkWhatsAppSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  appSecret: string | undefined,
  isProd: boolean
): SignatureCheck {
  const secret = appSecret?.trim();
  if (!secret) {
    // Never accept unsigned traffic in production.
    return isProd
      ? { ok: false, status: 500, error: 'Webhook verification not configured' }
      : { ok: true };
  }
  if (!signatureHeader) return { ok: false, status: 401, error: 'Missing signature' };

  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const provided = signatureHeader.replace(/^sha256=/, '');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, status: 401, error: 'Invalid signature' };
  }
  return { ok: true };
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

/**
 * Verify the signature of a raw webhook body. Sends the error response and returns false when invalid.
 */
export function verifyRawWhatsAppSignature(req: IncomingMessage, rawBody: string, res: VercelResponse): boolean {
  const header = req.headers['x-hub-signature-256'] as string | undefined;
  const result = checkWhatsAppSignature(rawBody, header, process.env.WHATSAPP_APP_SECRET, isProduction());
  if (!result.ok) {
    if (result.status === 500) console.error('WHATSAPP_APP_SECRET is required in production');
    res.status(result.status).json({ error: result.error });
    return false;
  }
  return true;
}

/**
 * Convenience for handlers that only have a parsed body. Prefer verifyRawWhatsAppSignature:
 * this re-serialises the body, which fails for payloads with non-ASCII text.
 */
export function verifyWhatsAppWebhookSignature(req: VercelRequest, res: VercelResponse): boolean {
  return verifyRawWhatsAppSignature(req, JSON.stringify(req.body), res);
}
