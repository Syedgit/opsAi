import crypto from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { checkWhatsAppSignature, verifyWhatsAppWebhookSignature } from '../whatsappSignature';

function mockRes(): VercelResponse {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as VercelResponse;
}

describe('verifyWhatsAppWebhookSignature', () => {
  const originalSecret = process.env.WHATSAPP_APP_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = originalSecret;
    delete process.env.NODE_ENV;
    delete process.env.VERCEL_ENV;
  });

  it('accepts valid signature', () => {
    process.env.WHATSAPP_APP_SECRET = 'meta-secret';
    const body = { object: 'whatsapp_business_account' };
    const digest = crypto.createHmac('sha256', 'meta-secret').update(JSON.stringify(body)).digest('hex');
    const req = {
      body,
      headers: { 'x-hub-signature-256': `sha256=${digest}` },
    } as unknown as VercelRequest;
    const res = mockRes();
    expect(verifyWhatsAppWebhookSignature(req, res)).toBe(true);
  });

  it('rejects invalid signature', () => {
    process.env.WHATSAPP_APP_SECRET = 'meta-secret';
    const req = {
      body: { test: true },
      headers: { 'x-hub-signature-256': 'sha256=deadbeef' },
    } as unknown as VercelRequest;
    const res = mockRes();
    expect(verifyWhatsAppWebhookSignature(req, res)).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});

describe('checkWhatsAppSignature (raw body)', () => {
  const sign = (raw: string, secret = 'meta-secret') => `sha256=${crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex')}`;

  // Meta escapes non-ASCII as \uXXXX in the bytes it signs; JSON.stringify of the parsed body does not.
  const rawWithAccent = '{"text":{"body":"caf\\u00e9 sales \\ud83d\\udc4d"}}';

  it('accepts a payload with accents and emoji when checked against the raw bytes', () => {
    expect(checkWhatsAppSignature(rawWithAccent, sign(rawWithAccent), 'meta-secret', true)).toEqual({ ok: true });
  });

  it('would have rejected that same genuine payload when re-serialising the parsed JSON', () => {
    const reserialised = JSON.stringify(JSON.parse(rawWithAccent));
    expect(reserialised).not.toBe(rawWithAccent);
    expect(checkWhatsAppSignature(reserialised, sign(rawWithAccent), 'meta-secret', true)).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a tampered body', () => {
    expect(checkWhatsAppSignature('{"a":2}', sign('{"a":1}'), 'meta-secret', true)).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a missing signature', () => {
    expect(checkWhatsAppSignature('{}', undefined, 'meta-secret', true)).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects a signature made with the wrong secret', () => {
    expect(checkWhatsAppSignature('{}', sign('{}', 'other'), 'meta-secret', true)).toMatchObject({ ok: false, status: 401 });
  });

  it('refuses unsigned traffic in production when no secret is configured', () => {
    expect(checkWhatsAppSignature('{}', undefined, '', true)).toMatchObject({ ok: false, status: 500 });
    expect(checkWhatsAppSignature('{}', undefined, undefined, true)).toMatchObject({ ok: false, status: 500 });
  });

  it('allows unsigned traffic only outside production (local development)', () => {
    expect(checkWhatsAppSignature('{}', undefined, '', false)).toEqual({ ok: true });
  });
});
